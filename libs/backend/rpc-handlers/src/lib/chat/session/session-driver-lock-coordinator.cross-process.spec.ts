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
import {
  SessionRegistry,
  type SessionLifecycleManager,
} from '@ptah-extension/agent-sdk';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AISessionConfig } from '@ptah-extension/shared';
import { SessionDriverLockCoordinator } from './session-driver-lock-coordinator';

(process.platform === 'linux' || process.platform === 'win32'
  ? describe
  : describe.skip)('coordinator cross-process rebind', () => {
  it('takes the new kernel name before dropping the old one', async () => {
    const originalHome = process.env['HOME'];
    const testHome = mkdtempSync(`${tmpdir()}/ptah-driver-test-`);
    process.env['HOME'] = testHome;
    const registry = new SessionRegistry({
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger);
    const lifecycle = {
      onRecordRemoved: registry.onRecordRemoved.bind(registry),
      onRealSessionIdBound: registry.onRealSessionIdBound.bind(registry),
      onRealSessionIdRebound: registry.onRealSessionIdRebound.bind(registry),
      find: registry.find.bind(registry),
      endSessionIfTokenMatches: jest.fn(),
    } as unknown as SessionLifecycleManager;
    const lock = new KernelSessionDriverLock();
    const coordinator = new SessionDriverLockCoordinator(
      lock,
      lifecycle,
      createMockLogger(),
      { type: PlatformType.Electron },
    );
    const oldId = `rebind-old-${process.pid}-${Date.now()}`;
    const newId = `rebind-new-${process.pid}-${Date.now()}`;
    const record = registry.register(
      'tab',
      { model: 'test', projectPath: '/tmp' } as AISessionConfig,
      new AbortController(),
    );
    try {
      registry.bindRealSessionId('tab', oldId);
      await coordinator.assertRecordAdmission('tab');
      registry.bindRealSessionId('tab', newId, record.token);
      await coordinator.assertRecordAdmission('tab');
      expect(lock.held().map((entry) => entry.sessionId)).toContain(newId);
      expect(lock.held().map((entry) => entry.sessionId)).not.toContain(oldId);
      const child = await spawnDriverLockHolder(newId);
      const answer = child.result;
      expect(answer).toBe('REFUSED');
    } finally {
      registry.remove(record);
      await coordinator.abandonDrive(newId, 'tab');
      await lock.dispose();
      if (originalHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = originalHome;
      rmSync(testHome, { recursive: true, force: true });
    }
  }, 15000);
});
