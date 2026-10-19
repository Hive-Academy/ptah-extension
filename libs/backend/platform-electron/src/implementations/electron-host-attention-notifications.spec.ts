import type { AttentionOpenTargetPayload } from '@ptah-extension/shared';
import type { SafeHostAttentionNotice } from '@ptah-extension/platform-core';
import { runHostAttentionContract } from '@ptah-extension/platform-core/testing';
import { ElectronHostAttentionNotifications, type ElectronNotificationHandle } from './electron-host-attention-notifications';

const target = { workspaceId: 'workspace', sessionId: 'session' };
const notice: SafeHostAttentionNotice = {
  key: 'r:permission:one', generation: 1, kind: 'permission', severity: 'warning',
  label: 'Permission needed', actionLabel: 'Open Ptah', sessionTitle: 'Session title', target,
};

describe('ElectronHostAttentionNotifications', () => {
  let eligible = true;
  let presented: SafeHostAttentionNotice[] = [];
  let opened: AttentionOpenTargetPayload[] = [];
  let handles: Array<{ close: jest.Mock; click: () => void }> = [];
  let provider: ElectronHostAttentionNotifications;

  const createProvider = () => {
    const native = (options: { title: string; body: string }): ElectronNotificationHandle => {
      expect(options.body).not.toContain('secret prompt');
      const handle: { close: jest.Mock; click: () => void } = { close: jest.fn(), click: () => undefined };
      handles.push(handle);
      return {
        show: jest.fn(), close: handle.close,
        on: (_event, listener) => { handle.click = listener; },
      };
    };
    provider = new ElectronHostAttentionNotifications({
      createNotification: native,
      notificationsSupported: () => true,
      isWindowFocused: () => !eligible,
      revealWindow: jest.fn(),
      sendToRenderer: (message) => opened.push(message.payload),
      isRendererReady: () => true,
    });
    return {
      present(value: SafeHostAttentionNotice) {
        const before = handles.length;
        provider.present(value);
        if (handles.length > before) presented.push(value);
      },
      resolve: (key: string, generation: number) => provider.resolve(key, generation),
      isEligible: () => provider.isEligible(),
      open: (route: AttentionOpenTargetPayload) => provider.open(route),
      dispose: () => provider.dispose(),
    };
  };

  runHostAttentionContract('Electron', {
    createProvider: () => {
      presented = []; opened = []; handles = [];
      return createProvider();
    },
    presented: () => presented,
    active: () => {
      const active = Reflect.get(provider, 'active') as Map<string, { notice: SafeHostAttentionNotice }>;
      return [...active.values()].map(({ notice }) => ({ key: notice.key, generation: notice.generation }));
    },
    opened: () => opened,
    setEligible: (value) => { eligible = value; },
  });

  it('uses the fixed label and title, and closes on resolve', () => {
    const adapter = createProvider();
    adapter.present(notice);
    expect(handles).toHaveLength(1);
    adapter.resolve(notice.key, notice.generation);
    expect(handles[0].close).toHaveBeenCalledTimes(1);
    handles[0].click();
    expect(opened).toEqual([]);
  });

  it('queues a click until ready and rechecks its generation', () => {
    let ready = false;
    let flush: (() => void) | undefined;
    const route = jest.fn();
    const native = { show: jest.fn(), close: jest.fn(), on: jest.fn() };
    const adapter = new ElectronHostAttentionNotifications({
      createNotification: () => native,
      notificationsSupported: () => true,
      isWindowFocused: () => false,
      revealWindow: jest.fn(),
      sendToRenderer: route,
      isRendererReady: () => ready,
      onRendererReady: (listener) => { flush = listener; return true; },
    });
    adapter.present(notice);
    adapter.open({ key: notice.key, generation: 1, target });
    expect(route).not.toHaveBeenCalled();
    adapter.resolve(notice.key, 1);
    ready = true;
    flush?.();
    expect(route).not.toHaveBeenCalled();
  });

  it('skips unsupported and focused windows without throwing', () => {
    const createNotification = jest.fn();
    const adapter = new ElectronHostAttentionNotifications({
      createNotification, notificationsSupported: () => false,
      isWindowFocused: () => false,
    });
    adapter.present(notice);
    expect(createNotification).not.toHaveBeenCalled();
    const focused = new ElectronHostAttentionNotifications({
      createNotification, notificationsSupported: () => true,
      isWindowFocused: () => true,
    });
    focused.present(notice);
    expect(createNotification).not.toHaveBeenCalled();
    expect(new ElectronHostAttentionNotifications({}).isEligible()).toBe(false);
  });

  it('groups a burst and opens the surviving current member', () => {
    const clicks: Array<() => void> = [];
    const close = jest.fn();
    const route = jest.fn();
    const reveal = jest.fn();
    const native = jest.fn(() => ({
      show: jest.fn(), close,
      on: (_event: 'click', listener: () => void) => { clicks.push(listener); },
    }));
    const adapter = new ElectronHostAttentionNotifications({
      createNotification: native, notificationsSupported: () => true,
      isWindowFocused: () => false, revealWindow: reveal, sendToRenderer: route,
    });
    const next = { ...notice, key: 'r:permission:two', generation: 2 };
    adapter.present(notice);
    adapter.present(next);
    expect(native).toHaveBeenCalledTimes(2);
    expect(native).toHaveBeenLastCalledWith({ title: 'Ptah', body: '2 requests need you — Session title' });
    adapter.resolve(notice.key, 1);
    expect(native).toHaveBeenCalledTimes(3);
    expect(native).toHaveBeenLastCalledWith({ title: 'Ptah', body: 'Permission needed — Session title' });
    expect(close).toHaveBeenCalledTimes(2);
    clicks[2]();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledWith(expect.objectContaining({ payload: {
      key: next.key, generation: next.generation, target: next.target,
    } }));
    adapter.resolve(next.key, 2);
    expect(close).toHaveBeenCalledTimes(3);
  });

  it('keeps only the latest cold-start route until Angular is ready', () => {
    let ready = false;
    let signalReady: (() => void) | undefined;
    const send = jest.fn();
    const adapter = new ElectronHostAttentionNotifications({
      createNotification: () => ({ show: jest.fn(), close: jest.fn(), on: jest.fn() }),
      notificationsSupported: () => true, isWindowFocused: () => false,
      revealWindow: jest.fn(), hasLiveWindow: () => true, sendToRenderer: send,
      isRendererReady: () => ready,
      onRendererReady: (listener) => { signalReady = listener; return true; },
    });
    const next = { ...notice, key: 'r:permission:two', generation: 2 };
    adapter.present(notice);
    adapter.present(next);
    adapter.open({ key: notice.key, generation: 1, target });
    adapter.open({ key: next.key, generation: 2, target });
    expect(send).not.toHaveBeenCalled();
    ready = true;
    signalReady?.();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ payload: {
      key: next.key, generation: next.generation, target: next.target,
    } }));
  });

  it('retries renderer readiness registration after a missing window', () => {
    const send = jest.fn();
    let listener: (() => void) | undefined;
    let canRegister = false;
    const adapter = new ElectronHostAttentionNotifications({
      createNotification: () => ({ show: jest.fn(), close: jest.fn(), on: jest.fn() }),
      notificationsSupported: () => true, isWindowFocused: () => false,
      hasLiveWindow: () => true, revealWindow: jest.fn(), sendToRenderer: send,
      isRendererReady: () => false,
      onRendererReady: (callback) => { if (!canRegister) return false; listener = callback; return true; },
    });
    adapter.present(notice);
    adapter.open({ key: notice.key, generation: 1, target });
    canRegister = true;
    adapter.open({ key: notice.key, generation: 1, target });
    listener?.();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
