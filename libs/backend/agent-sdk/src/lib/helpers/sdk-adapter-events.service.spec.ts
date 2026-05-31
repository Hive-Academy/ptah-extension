import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SdkAdapterEvents } from './sdk-adapter-events.service';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

describe('SdkAdapterEvents', () => {
  function make(): { events: SdkAdapterEvents; logger: MockLogger } {
    const logger = createMockLogger();
    const events = new SdkAdapterEvents(asLogger(logger));
    return { events, logger };
  }

  describe('initialized', () => {
    it('delivers payload to subscribers', () => {
      const { events } = make();
      const listener = jest.fn();
      events.onInitialized(listener);

      events.emitInitialized({ success: true, timestamp: 123 });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ success: true, timestamp: 123 });
    });

    it('supports multiple subscribers', () => {
      const { events } = make();
      const a = jest.fn();
      const b = jest.fn();
      events.onInitialized(a);
      events.onInitialized(b);

      events.emitInitialized({ success: false, timestamp: 1 });

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('returns an unsubscribe function that stops further delivery', () => {
      const { events } = make();
      const listener = jest.fn();
      const off = events.onInitialized(listener);

      events.emitInitialized({ success: true, timestamp: 1 });
      off();
      events.emitInitialized({ success: true, timestamp: 2 });

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('disposed', () => {
    it('delivers payload to subscribers', () => {
      const { events } = make();
      const listener = jest.fn();
      events.onDisposed(listener);

      events.emitDisposed({ timestamp: 999 });

      expect(listener).toHaveBeenCalledWith({ timestamp: 999 });
    });
  });

  describe('configChanged', () => {
    it('delivers payload to subscribers', () => {
      const { events } = make();
      const listener = jest.fn();
      events.onConfigChanged(listener);

      events.emitConfigChanged({ key: 'authMethod', timestamp: 42 });

      expect(listener).toHaveBeenCalledWith({
        key: 'authMethod',
        timestamp: 42,
      });
    });
  });

  describe('listener isolation', () => {
    it('does not cross-deliver between event channels', () => {
      const { events } = make();
      const initListener = jest.fn();
      const disposedListener = jest.fn();
      const configListener = jest.fn();

      events.onInitialized(initListener);
      events.onDisposed(disposedListener);
      events.onConfigChanged(configListener);

      events.emitInitialized({ success: true, timestamp: 1 });

      expect(initListener).toHaveBeenCalledTimes(1);
      expect(disposedListener).not.toHaveBeenCalled();
      expect(configListener).not.toHaveBeenCalled();
    });
  });

  describe('safeEmit', () => {
    it('logs and swallows when a listener throws so other listeners still fire', () => {
      const { events, logger } = make();
      const throwing = jest.fn(() => {
        throw new Error('boom');
      });
      events.onInitialized(throwing);

      expect(() =>
        events.emitInitialized({ success: true, timestamp: 1 }),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('swallows compactionComplete listener throws and logs', () => {
      const { events, logger } = make();
      const throwing = jest.fn(() => {
        throw new Error('listener boom');
      });
      events.onCompactionComplete(throwing);

      expect(() =>
        events.emitCompactionComplete({
          sessionId: 'sess-1',
          cwd: '/repo',
          trigger: 'auto',
          compactSummary: 'summary',
          timestamp: 1,
        }),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('compactionComplete', () => {
    it('delivers payload to subscribers', () => {
      const { events } = make();
      const listener = jest.fn();
      events.onCompactionComplete(listener);

      const payload = {
        sessionId: 'sess-7',
        cwd: '/repo',
        trigger: 'manual' as const,
        compactSummary: 'summary text',
        timestamp: 1700,
      };
      events.emitCompactionComplete(payload);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(payload);
    });

    it('supports auto trigger and multiple subscribers', () => {
      const { events } = make();
      const a = jest.fn();
      const b = jest.fn();
      events.onCompactionComplete(a);
      events.onCompactionComplete(b);

      events.emitCompactionComplete({
        sessionId: 'sess-9',
        cwd: '/repo',
        trigger: 'auto',
        compactSummary: 's',
        timestamp: 2,
      });

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('returns an unsubscribe function that stops further delivery', () => {
      const { events } = make();
      const listener = jest.fn();
      const off = events.onCompactionComplete(listener);

      events.emitCompactionComplete({
        sessionId: 'sess-1',
        cwd: '/repo',
        trigger: 'manual',
        compactSummary: 's',
        timestamp: 1,
      });
      off();
      events.emitCompactionComplete({
        sessionId: 'sess-1',
        cwd: '/repo',
        trigger: 'manual',
        compactSummary: 's',
        timestamp: 2,
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not cross-deliver between compactionComplete and other channels', () => {
      const { events } = make();
      const compactionListener = jest.fn();
      const initListener = jest.fn();
      events.onCompactionComplete(compactionListener);
      events.onInitialized(initListener);

      events.emitCompactionComplete({
        sessionId: 'sess-1',
        cwd: '/repo',
        trigger: 'manual',
        compactSummary: 's',
        timestamp: 1,
      });

      expect(compactionListener).toHaveBeenCalledTimes(1);
      expect(initListener).not.toHaveBeenCalled();
    });
  });

  describe('root-barrel reachability smoke', () => {
    it('exposes SdkAdapterCompactionCompleteEvent type via root barrel', async () => {
      const rootBarrel = await import('../../index');
      const helpersBarrel = await import('./index');
      expect(rootBarrel.SdkAdapterEvents).toBeDefined();
      expect(helpersBarrel.SdkAdapterEvents).toBeDefined();
      expect(helpersBarrel.isPostCompactHook).toBeDefined();
    });

    it('exposes StopFailureHookHandler + isStopFailureHook via both barrels', async () => {
      const rootBarrel = await import('../../index');
      const helpersBarrel = await import('./index');
      expect(rootBarrel.StopFailureHookHandler).toBeDefined();
      expect(helpersBarrel.StopFailureHookHandler).toBeDefined();
      expect(rootBarrel.isStopFailureHook).toBeDefined();
      expect(helpersBarrel.isStopFailureHook).toBeDefined();
    });
  });

  describe('turnEnded', () => {
    const baseEvent = {
      sessionId: 'sess-1',
      cwd: '/repo',
      lastAssistantMessage: 'done',
      backgroundTasks: [] as ReadonlyArray<never>,
      sessionCrons: [] as ReadonlyArray<never>,
      terminalReason: null,
      timestamp: 100,
    } as const;

    it('delivers payload to subscribers', () => {
      const { events } = make();
      const listener = jest.fn();
      events.onTurnEnded(listener);

      events.emitTurnEnded(baseEvent);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(baseEvent);
    });

    it('returns an unsubscribe function that stops further delivery', () => {
      const { events } = make();
      const listener = jest.fn();
      const off = events.onTurnEnded(listener);

      events.emitTurnEnded(baseEvent);
      off();
      events.emitTurnEnded({ ...baseEvent, timestamp: 200 });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not cross-deliver to other channels', () => {
      const { events } = make();
      const turnListener = jest.fn();
      const turnFailedListener = jest.fn();
      const compactionListener = jest.fn();
      events.onTurnEnded(turnListener);
      events.onTurnFailed(turnFailedListener);
      events.onCompactionComplete(compactionListener);

      events.emitTurnEnded(baseEvent);

      expect(turnListener).toHaveBeenCalledTimes(1);
      expect(turnFailedListener).not.toHaveBeenCalled();
      expect(compactionListener).not.toHaveBeenCalled();
    });

    it('swallows listener throws and logs (safeEmit)', () => {
      const { events, logger } = make();
      events.onTurnEnded(() => {
        throw new Error('boom turn');
      });

      expect(() => events.emitTurnEnded(baseEvent)).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('turnFailed', () => {
    const baseEvent = {
      sessionId: 'sess-1',
      cwd: '/repo',
      lastAssistantMessage: null,
      error: 'rate_limit' as const,
      errorDetails: 'too many',
      terminalReason: null,
      timestamp: 100,
    } as const;

    it('delivers payload to subscribers', () => {
      const { events } = make();
      const listener = jest.fn();
      events.onTurnFailed(listener);

      events.emitTurnFailed(baseEvent);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(baseEvent);
    });

    it('returns an unsubscribe function that stops further delivery', () => {
      const { events } = make();
      const listener = jest.fn();
      const off = events.onTurnFailed(listener);

      events.emitTurnFailed(baseEvent);
      off();
      events.emitTurnFailed({ ...baseEvent, timestamp: 200 });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not cross-deliver to turnEnded', () => {
      const { events } = make();
      const turnListener = jest.fn();
      const turnFailedListener = jest.fn();
      events.onTurnEnded(turnListener);
      events.onTurnFailed(turnFailedListener);

      events.emitTurnFailed(baseEvent);

      expect(turnFailedListener).toHaveBeenCalledTimes(1);
      expect(turnListener).not.toHaveBeenCalled();
    });

    it('swallows listener throws and logs (safeEmit)', () => {
      const { events, logger } = make();
      events.onTurnFailed(() => {
        throw new Error('boom failed');
      });

      expect(() => events.emitTurnFailed(baseEvent)).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('removeAllListeners', () => {
    it('clears every subscription so subsequent emits reach nobody', () => {
      const { events } = make();
      const init = jest.fn();
      const disp = jest.fn();
      const cfg = jest.fn();
      events.onInitialized(init);
      events.onDisposed(disp);
      events.onConfigChanged(cfg);

      events.removeAllListeners();

      events.emitInitialized({ success: true, timestamp: 1 });
      events.emitDisposed({ timestamp: 1 });
      events.emitConfigChanged({ key: 'k', timestamp: 1 });

      expect(init).not.toHaveBeenCalled();
      expect(disp).not.toHaveBeenCalled();
      expect(cfg).not.toHaveBeenCalled();
      expect(events.listenerCount('initialized')).toBe(0);
      expect(events.listenerCount('disposed')).toBe(0);
      expect(events.listenerCount('configChanged')).toBe(0);
    });
  });
});
