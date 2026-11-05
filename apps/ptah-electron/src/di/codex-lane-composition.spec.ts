import 'reflect-metadata';
import { container } from 'tsyringe';
import { CLI_AGENT_RUNTIME_TOKENS, type CodexAdapterFactory } from '@ptah-extension/cli-agent-runtime';
import { CODEX_RUNTIME_TOKENS, CodexSelectionSnapshot } from '@ptah-extension/codex-runtime';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { Logger } from '@ptah-extension/vscode-core';
import {
  isElectronCodexLaneAdmitted,
  registerElectronCodexLaneFactory,
  resolveElectronCodexLaneRuntime,
} from './codex-lane-composition';

const hosts = ['linux', 'darwin', 'win32'].flatMap((platform) =>
  ['arm64', 'x64'].flatMap((arch) => [false, true].map((isPackaged) =>
    ({ platform, arch, isPackaged }))));

function snapshot(version: string) {
  return new CodexSelectionSnapshot({
    installedCandidates: async () => ['/installed'],
    bundledCandidate: async () => '/bundled',
    canonicalNativePath: async (path) => path,
    readVersion: async (path) => path === '/installed'
      ? `codex-cli ${version}` : 'codex-cli 0.165.0',
  });
}

describe('Electron Codex lanes', () => {
  const logger = Object.create(Logger.prototype) as Logger;
  it('uses a bundled lane selection once after an unsupported installed method', async () => {
    const selected = snapshot('0.166.0');
    const first = await selected.selectForOpen();
    expect(first.selected.source).toBe('installed');
    const fallback = await selected.activateFallback(first.selected, 'turn/start');
    expect(fallback).toMatchObject({ source: 'bundled', path: '/bundled' });
    expect(fallback.reason).toContain('turn/start');
    await expect(selected.activateFallback(first.selected, 'turn/start')).rejects.toThrow();
  });
  it.each(hosts)('registers a lane on $platform/$arch packaged=$isPackaged',
    async ({ platform, arch, isPackaged }) => {
      const scope = container.createChildContainer();
      const runtime = { marker: 'runtime' };
      const input = {
        isPackaged, platform: { platform, arch },
        resourcesPath: '/fixture', appPath: '/fixture', env: {},
      };
      scope.register(CODEX_RUNTIME_TOKENS.Runtime, { useValue: runtime });
      try {
        expect(isElectronCodexLaneAdmitted(input)).toBe(true);
        registerElectronCodexLaneFactory(scope, logger, input);
        expect(scope.isRegistered(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY)).toBe(true);
        expect(resolveElectronCodexLaneRuntime(scope, input)).toBe(runtime);
      } finally {
        await scope.dispose();
      }
    });

  it.each([['win32', 1], ['linux', 0]])('prewarms WRITE_DAC for workspace folders on %s', async (platform, calls) => {
    const scope = container.createChildContainer();
    const workspace = {
      getWorkspaceFolders: jest.fn((): string[] => []),
      onDidChangeWorkspaceFolders: jest.fn(),
    };
    scope.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { useValue: workspace });
    try {
      registerElectronCodexLaneFactory(scope, logger, {
        isPackaged: true, platform: { platform, arch: 'x64' },
        resourcesPath: '/fixture', appPath: '/fixture', env: {},
      });
      expect(workspace.getWorkspaceFolders).toHaveBeenCalledTimes(calls);
      expect(workspace.onDidChangeWorkspaceFolders).toHaveBeenCalledTimes(calls);
    } finally {
      await scope.dispose();
    }
  });

  it.each([
    ['0.166.0', 'installed'],
    ['0.164.0', 'bundled'],
  ])('detects the shared %s selection', async (version, source) => {
    const scope = container.createChildContainer();
    const selected = snapshot(version);
    scope.register(CODEX_RUNTIME_TOKENS.SelectionSnapshot, { useValue: selected });
    registerElectronCodexLaneFactory(scope, logger, {
      isPackaged: true, platform: { platform: 'linux', arch: 'arm64' },
      resourcesPath: '/fixture', appPath: '/fixture', env: {},
    });
    try {
      const factory = scope.resolve<CodexAdapterFactory>(
        CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY,
      );
      const result = await factory.create().detect();
      expect(result?.version).toBe('0.165.0' === version ? '0.165.0' :
        source === 'installed' ? version : '0.165.0');
      expect(selected.current()?.source).toBe(source);
    } finally {
      await scope.dispose();
    }
  });
});
