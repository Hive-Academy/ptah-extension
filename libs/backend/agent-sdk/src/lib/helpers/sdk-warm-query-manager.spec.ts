import 'reflect-metadata';

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  startup: jest.fn(),
}));

const sdkModuleMock = require('@anthropic-ai/claude-agent-sdk') as {
  startup: jest.Mock;
};
function getMockedStartup(): jest.Mock {
  return sdkModuleMock.startup;
}

import type { Logger } from '@ptah-extension/vscode-core';
import type { IPlatformInfo } from '@ptah-extension/platform-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SdkWarmQueryManager } from './sdk-warm-query-manager';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

const SAFE_CWD = '/workspace/repo';

const PLATFORM_INFO_STUB: IPlatformInfo = {
  type: 'cli' as IPlatformInfo['type'],
  extensionPath: '/opt/ptah-app',
  globalStoragePath: '/opt/ptah-storage',
  workspaceStoragePath: '/opt/ptah-workspace-storage',
};

interface Harness {
  manager: SdkWarmQueryManager;
  logger: MockLogger;
}

function makeManager(): Harness {
  const logger = createMockLogger();
  const manager = new SdkWarmQueryManager(asLogger(logger), PLATFORM_INFO_STUB);
  return { manager, logger };
}

describe('SdkWarmQueryManager', () => {
  beforeEach(() => {
    getMockedStartup().mockReset();
  });

  describe('prewarm()', () => {
    it('invokes SDK startup() once and retains the WarmQuery (does not close it)', async () => {
      const h = makeManager();
      const close = jest.fn();
      getMockedStartup().mockResolvedValueOnce({ close });

      await h.manager.prewarm(null, SAFE_CWD);

      expect(getMockedStartup()).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();
      const consumed = h.manager.consumeWarmQuery();
      expect(consumed).not.toBeNull();
      expect((consumed as { close: () => void }).close).toBe(close);
      expect(h.manager.consumeWarmQuery()).toBeNull();
    });

    it('is idempotent — second call is a no-op (does not call startup() again)', async () => {
      const h = makeManager();
      getMockedStartup().mockResolvedValue({ close: jest.fn() });

      await h.manager.prewarm(null, SAFE_CWD);
      await h.manager.prewarm(null, SAFE_CWD);
      await h.manager.prewarm(null, SAFE_CWD);

      expect(getMockedStartup()).toHaveBeenCalledTimes(1);
    });

    it('swallows startup() failures with logger.warn — never throws upward', async () => {
      const h = makeManager();
      const failure = new Error('subprocess spawn failed');
      getMockedStartup().mockRejectedValueOnce(failure);

      await expect(h.manager.prewarm(null, SAFE_CWD)).resolves.toBeUndefined();

      expect(h.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SDK prewarm failed'),
      );
    });

    it('allows retry on failure — does not mark prewarmed when startup() rejects', async () => {
      const h = makeManager();
      getMockedStartup()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ close: jest.fn() });

      await h.manager.prewarm(null, SAFE_CWD);
      await h.manager.prewarm(null, SAFE_CWD);

      expect(getMockedStartup()).toHaveBeenCalledTimes(2);
    });

    it('passes pathToClaudeCodeExecutable into startup() options when CLI js path is resolved', async () => {
      const h = makeManager();
      const close = jest.fn();
      getMockedStartup().mockResolvedValueOnce({ close });

      await h.manager.prewarm('/bin/cli.js', SAFE_CWD);

      expect(getMockedStartup()).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            pathToClaudeCodeExecutable: '/bin/cli.js',
          }),
        }),
      );
    });

    it('passes mcpServers into startup() when provided', async () => {
      const h = makeManager();
      const close = jest.fn();
      getMockedStartup().mockResolvedValueOnce({ close });

      const mcpServers = {
        ptah: { type: 'http', url: 'http://localhost:9999' },
      };
      await h.manager.prewarm(null, SAFE_CWD, mcpServers);

      expect(getMockedStartup()).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ mcpServers }),
        }),
      );
    });
  });

  describe('consumeWarmQuery()', () => {
    it('does not throw when stale WarmQuery.close() throws during TTL eviction', async () => {
      const h = makeManager();
      const closeError = new Error('close failed');
      getMockedStartup().mockResolvedValueOnce({
        close: () => {
          throw closeError;
        },
      });

      await expect(h.manager.prewarm(null, SAFE_CWD)).resolves.toBeUndefined();

      (
        h.manager as unknown as { _warmQueryCreatedAt: number }
      )._warmQueryCreatedAt = Date.now() - 10 * 60 * 1000;

      expect(h.manager.consumeWarmQuery()).toBeNull();
      expect(h.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Stale WarmQuery.close()'),
        closeError,
      );
    });

    it('discards a stale warm handle (>5min) on consumeWarmQuery and resets prewarmed flag', async () => {
      const h = makeManager();
      const close = jest.fn();
      getMockedStartup().mockResolvedValueOnce({ close });

      await h.manager.prewarm(null, SAFE_CWD);

      (
        h.manager as unknown as { _warmQueryCreatedAt: number }
      )._warmQueryCreatedAt = Date.now() - 6 * 60 * 1000;

      const consumed = h.manager.consumeWarmQuery();
      expect(consumed).toBeNull();
      expect(close).toHaveBeenCalledTimes(1);

      getMockedStartup().mockResolvedValueOnce({ close: jest.fn() });
      await h.manager.prewarm(null, SAFE_CWD);
      expect(getMockedStartup()).toHaveBeenCalledTimes(2);
    });

    it('discards warm handle when fingerprint requirement (cli path) mismatches', async () => {
      const h = makeManager();
      const close = jest.fn();
      getMockedStartup().mockResolvedValueOnce({ close, query: jest.fn() });
      await h.manager.prewarm('/bin/cli.js', SAFE_CWD);

      const consumed = h.manager.consumeWarmQuery({
        pathToClaudeCodeExecutable: '/different/cli.js',
        mcpServers: null,
        cwd: SAFE_CWD,
      });

      expect(consumed).toBeNull();
      expect(close).toHaveBeenCalledTimes(1);
      expect(h.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('fingerprint mismatch'),
      );
    });

    it('discards warm handle when fingerprint requirement (mcpServers) mismatches', async () => {
      const h = makeManager();
      const close = jest.fn();
      getMockedStartup().mockResolvedValueOnce({ close, query: jest.fn() });

      await h.manager.prewarm(null, SAFE_CWD, {
        x: { type: 'http', url: 'http://x' },
      });

      const consumed = h.manager.consumeWarmQuery({
        pathToClaudeCodeExecutable: null,
        mcpServers: null,
        cwd: SAFE_CWD,
      });

      expect(consumed).toBeNull();
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('returns warm handle when fingerprint requirements match exactly', async () => {
      const h = makeManager();
      const close = jest.fn();
      const warmQuery = jest.fn();
      getMockedStartup().mockResolvedValueOnce({ close, query: warmQuery });

      await h.manager.prewarm(null, SAFE_CWD);

      const consumed = h.manager.consumeWarmQuery({
        pathToClaudeCodeExecutable: null,
        mcpServers: null,
        cwd: SAFE_CWD,
      });

      expect(consumed).not.toBeNull();
      expect(close).not.toHaveBeenCalled();
    });

    it('returns null when no handle is held', () => {
      const h = makeManager();
      expect(h.manager.consumeWarmQuery()).toBeNull();
    });
  });

  describe('fingerprintMismatchReason() static', () => {
    it('returns null when fingerprints match exactly', () => {
      expect(
        SdkWarmQueryManager.fingerprintMismatchReason(
          {
            pathToClaudeCodeExecutable: '/cli.js',
            mcpServers: null,
            baseUrl: null,
            authEnvHash: null,
            cwd: SAFE_CWD,
          },
          {
            pathToClaudeCodeExecutable: '/cli.js',
            mcpServers: null,
            baseUrl: null,
            authEnvHash: null,
            cwd: SAFE_CWD,
          },
        ),
      ).toBeNull();
    });

    it('flags baseUrl mismatch', () => {
      const reason = SdkWarmQueryManager.fingerprintMismatchReason(
        {
          pathToClaudeCodeExecutable: null,
          mcpServers: null,
          baseUrl: 'https://a.example',
          cwd: SAFE_CWD,
        },
        {
          pathToClaudeCodeExecutable: null,
          mcpServers: null,
          baseUrl: 'https://b.example',
          cwd: SAFE_CWD,
        },
      );
      expect(reason).toContain('baseUrl differs');
    });

    it('flags authEnvHash mismatch', () => {
      const reason = SdkWarmQueryManager.fingerprintMismatchReason(
        {
          pathToClaudeCodeExecutable: null,
          mcpServers: null,
          authEnvHash: 'hash-a',
          cwd: SAFE_CWD,
        },
        {
          pathToClaudeCodeExecutable: null,
          mcpServers: null,
          authEnvHash: 'hash-b',
          cwd: SAFE_CWD,
        },
      );
      expect(reason).toContain('authEnv');
    });
  });

  describe('dispose()', () => {
    it('closes held handle and resets prewarmed flag', async () => {
      const h = makeManager();
      const close = jest.fn();
      getMockedStartup().mockResolvedValueOnce({ close });

      await h.manager.prewarm(null, SAFE_CWD);
      h.manager.dispose();

      expect(close).toHaveBeenCalledTimes(1);
      expect(h.manager.consumeWarmQuery()).toBeNull();

      // Allows re-prewarm
      getMockedStartup().mockResolvedValueOnce({ close: jest.fn() });
      await h.manager.prewarm(null, SAFE_CWD);
      expect(getMockedStartup()).toHaveBeenCalledTimes(2);
    });
  });
});
