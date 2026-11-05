import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import { CLI_AGENT_RUNTIME_TOKENS, type CodexAdapterFactory } from '@ptah-extension/cli-agent-runtime';
import { CODEX_RUNTIME_TOKENS, type CodexSelectionSnapshotPort } from '@ptah-extension/codex-runtime';
import { Logger } from '@ptah-extension/vscode-core';
import { registerCliCodexLaneFactory } from './codex-lane-runtime-composition';

describe('CLI Codex lane composition', () => {
  const logger = Object.create(Logger.prototype) as Logger;

  it.each([
    { env: { CODEX_HOME: '' } },
    { env: { HOME: '' } },
  ])('reports an explicitly empty Codex home as not installed for $env', async ({ env }) => {
    const container = rootContainer.createChildContainer();
    const selected = {
      path: '/bin/codex', version: '0.165.0', source: 'installed' as const,
      reason: 'Using installed Codex 0.165.0',
    };
    const selectForOpen = jest.fn(async () => ({ selected }));
    container.register<CodexSelectionSnapshotPort>(CODEX_RUNTIME_TOKENS.SelectionSnapshot, {
      useValue: {
        selectForOpen,
        current: () => selected,
        activateFallback: async () => selected,
        markUnsupported: () => undefined,
      },
    });
    try {
      registerCliCodexLaneFactory(container, logger, {
        env, platform: { platform: 'linux', arch: 'x64' },
      });
      const lane = container.resolve<CodexAdapterFactory>(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY).create();
      await expect(lane.detect()).resolves.toEqual({
        cli: 'codex', installed: false, messagingMode: 'steer',
      });
      expect(selectForOpen).toHaveBeenCalledTimes(1);
    } finally {
      await container.dispose();
    }
  });

  it('keeps a non-empty HOME installed when the same binary resolves', async () => {
    const container = rootContainer.createChildContainer();
    const selected = {
      path: '/bin/codex', version: '0.165.0', source: 'installed' as const,
      reason: 'Using installed Codex 0.165.0',
    };
    const selectForOpen = jest.fn(async () => ({ selected }));
    container.register<CodexSelectionSnapshotPort>(CODEX_RUNTIME_TOKENS.SelectionSnapshot, {
      useValue: {
        selectForOpen,
        current: () => selected,
        activateFallback: async () => selected,
        markUnsupported: () => undefined,
      },
    });
    try {
      registerCliCodexLaneFactory(container, logger, {
        env: { HOME: '/tmp' }, platform: { platform: 'linux', arch: 'x64' },
      });
      const lane = container.resolve<CodexAdapterFactory>(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY).create();
      await expect(lane.detect()).resolves.toMatchObject({
        cli: 'codex', installed: true, path: '/bin/codex', version: '0.165.0',
      });
      expect(selectForOpen).toHaveBeenCalledTimes(1);
    } finally {
      await container.dispose();
    }
  });

  it.each([
    { platform: 'linux', arch: 'x64' },
    { platform: 'darwin', arch: 'arm64' },
    { platform: 'win32', arch: 'x64' },
  ])('registers lanes and one snapshot on $platform/$arch', async (platform) => {
    const container = rootContainer.createChildContainer();
    try {
      registerCliCodexLaneFactory(container, logger, { env: {}, platform });
      expect(container.isRegistered(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY)).toBe(true);
      const snapshot = container.resolve<CodexSelectionSnapshotPort>(
        CODEX_RUNTIME_TOKENS.SelectionSnapshot,
      );
      expect(snapshot.selectForOpen).toEqual(expect.any(Function));
      registerCliCodexLaneFactory(container, logger, { env: {}, platform });
      expect(container.resolve(CODEX_RUNTIME_TOKENS.SelectionSnapshot)).toBe(snapshot);
    } finally {
      await container.dispose();
    }
  });
});
