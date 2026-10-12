import type { Logger } from '@ptah-extension/vscode-core';
import { SessionStoreGate } from './session-store-gate';

describe('SessionStoreGate', () => {
  const logger = { warn: jest.fn() } as unknown as Logger;
  afterEach(() => jest.useRealTimers());

  it('stays closed until released', async () => {
    const gate = new SessionStoreGate(logger, 60_000);
    let opened = false;
    void gate.whenReady().then(() => (opened = true));
    await Promise.resolve();
    expect(opened).toBe(false);

    gate.markReady();
    await gate.whenReady();
    expect(opened).toBe(true);
  });

  it('opens by itself after the timeout and says so', async () => {
    jest.useFakeTimers();
    const gate = new SessionStoreGate(logger, 1_000);
    jest.advanceTimersByTime(1_000);
    await expect(gate.whenReady()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
