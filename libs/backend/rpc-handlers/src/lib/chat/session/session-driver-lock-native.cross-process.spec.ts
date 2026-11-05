import { createMockLogger } from '@ptah-extension/shared/testing';
import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
jest.mock('node:os', () => ({
  ...jest.requireActual('node:os'),
  homedir: () => process.env['HOME'],
}));
import {
  KernelSessionDriverLock,
  PlatformType,
} from '@ptah-extension/platform-core';
import { spawnDriverLockHolder } from '@ptah-extension/platform-core/testing';
import type { SessionLifecycleManager } from '@ptah-extension/agent-sdk';
import { SessionDriverLockCoordinator } from './session-driver-lock-coordinator';

(process.platform === 'linux' || process.platform === 'win32'
  ? describe
  : describe.skip)('native Codex driver lock across processes', () => {
  it('refuses a competing process while a native lease is held', async () => {
    const originalHome = process.env['HOME'];
    const testHome = mkdtempSync(`${tmpdir()}/ptah-native-driver-test-`);
    process.env['HOME'] = testHome;
    const lock = new KernelSessionDriverLock();
    const lifecycle = {
      onRecordRemoved: jest.fn(),
      onRealSessionIdBound: jest.fn(),
      onRealSessionIdRebound: jest.fn(),
    } as unknown as SessionLifecycleManager;
    const coordinator = new SessionDriverLockCoordinator(
      lock,
      lifecycle,
      createMockLogger(),
      { type: PlatformType.Electron },
    );
    const sessionId = `native-${process.pid}-${Date.now()}`;
    try {
      const lease = await coordinator.admitNative(sessionId, {
        consumer: 'chat',
        kind: 'start',
      });
      try {
        expect((await spawnDriverLockHolder(sessionId)).result).toBe('REFUSED');
      } finally {
        lease.release();
        await coordinator.abandonDrive(sessionId, 'unused');
      }
      expect((await spawnDriverLockHolder(sessionId)).result).toBe('ACQUIRED');
    } finally {
      await lock.dispose();
      if (originalHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = originalHome;
      rmSync(testHome, { recursive: true, force: true });
    }
  }, 15000);
});
