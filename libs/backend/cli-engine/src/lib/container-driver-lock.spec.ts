import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { container as rootContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  KernelSessionDriverLock,
  NullSessionDriverLock,
  type IOutputChannel,
  type ISessionDriverLock,
} from '@ptah-extension/platform-core';
import { registerPlatformCliServices } from '@ptah-extension/platform-cli';
import {
  registerVsCodeCorePlatformAgnostic,
  type Logger,
} from '@ptah-extension/vscode-core';

describe('CLI engine session driver lock composition', () => {
  it('fails to resolve when no host has bound the lock', () => {
    const c = rootContainer.createChildContainer();
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    } as unknown as Logger;
    registerVsCodeCorePlatformAgnostic(c, logger, {
      includeLicensingAndAuth: false,
    });
    expect(c.isRegistered(PLATFORM_TOKENS.SESSION_DRIVER_LOCK, true)).toBe(
      false,
    );
    expect(() => c.resolve(PLATFORM_TOKENS.SESSION_DRIVER_LOCK)).toThrow();
  });

  it('binds the platform lock for the CLI engine host', async () => {
    const c = rootContainer.createChildContainer();
    const dataPath = mkdtempSync(join(tmpdir(), 'ptah-cli-lock-'));
    try {
      registerPlatformCliServices(c, {
        appPath: dataPath,
        userDataPath: dataPath,
        logsPath: dataPath,
        workspacePath: dataPath,
      });
      const lock = c.resolve<ISessionDriverLock>(
        PLATFORM_TOKENS.SESSION_DRIVER_LOCK,
      );
      expect(lock).toBeInstanceOf(
        process.platform === 'darwin'
          ? NullSessionDriverLock
          : KernelSessionDriverLock,
      );
      expect(c.resolve(PLATFORM_TOKENS.SESSION_DRIVER_LOCK)).toBe(lock);
      await lock.dispose();
    } finally {
      c.resolve<IOutputChannel>(PLATFORM_TOKENS.OUTPUT_CHANNEL).dispose();
      rmSync(dataPath, { recursive: true, force: true });
    }
  });
});
