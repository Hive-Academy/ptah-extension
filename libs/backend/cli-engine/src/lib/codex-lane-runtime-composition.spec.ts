import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import { CLI_AGENT_RUNTIME_TOKENS } from '@ptah-extension/cli-agent-runtime';
import { CODEX_RUNTIME_TOKENS, type CodexSelectionSnapshotPort } from '@ptah-extension/codex-runtime';
import { Logger } from '@ptah-extension/vscode-core';
import { registerCliCodexLaneFactory } from './codex-lane-runtime-composition';

describe('CLI Codex lane composition', () => {
  const logger = Object.create(Logger.prototype) as Logger;
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
