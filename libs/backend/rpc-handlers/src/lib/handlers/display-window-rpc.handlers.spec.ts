import 'reflect-metadata';
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS, type IDisplayWindowHost } from '@ptah-extension/platform-core';
import {
  DISPLAY_WINDOW_STATE_MAX_BYTES,
  type DisplayWindowAction,
  type DisplayWindowSnapshot,
} from '@ptah-extension/shared';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { DisplayWindowRpcHandlers } from './display-window-rpc.handlers';

type Handler = (params: unknown) => Promise<unknown>;

function fakeHost(overrides: Partial<IDisplayWindowHost> = {}): jest.Mocked<IDisplayWindowHost> {
  return {
    supported: true,
    open: jest.fn(async () => ({ ok: true as const })),
    close: jest.fn(async () => true),
    isOpen: jest.fn(() => true),
    publishState: jest.fn(() => true),
    getState: jest.fn(() => null),
    relayAction: jest.fn(() => true),
    ...overrides,
  } as jest.Mocked<IDisplayWindowHost>;
}

function setup(host?: IDisplayWindowHost) {
  const methods = new Map<string, Handler>();
  const logger = { warn: jest.fn() } as Partial<Logger> as Logger;
  const rpc = {
    registerMethod: jest.fn((name: string, handler: Handler) => methods.set(name, handler)),
  } as Partial<RpcHandler> as RpcHandler;
  const container = {
    isRegistered: jest.fn((token: symbol) => token === PLATFORM_TOKENS.DISPLAY_WINDOW_HOST && !!host),
    resolve: jest.fn(() => host),
  } as Partial<DependencyContainer> as DependencyContainer;
  new DisplayWindowRpcHandlers(logger, rpc, container).register();
  const call = (name: string, params: unknown) => {
    const handler = methods.get(name);
    if (!handler) throw new Error(`Missing handler: ${name}`);
    return handler(params);
  };
  return { call, methods, logger, container };
}

const snapshot: DisplayWindowSnapshot = {
  tabId: 'tab-a',
  revision: 3,
  state: { selectedKey: 'summary', entries: [{ key: 'summary', count: 2 }], theme: null },
};

describe('DisplayWindowRpcHandlers', () => {
  it('registers exactly the six displayWindow methods', () => {
    const h = setup();
    expect([...h.methods.keys()].sort()).toEqual([...DisplayWindowRpcHandlers.METHODS].sort());
    expect(DisplayWindowRpcHandlers.METHODS).toHaveLength(6);
  });

  describe('with a bound host', () => {
    it('opens through the port and returns its result', async () => {
      const host = fakeHost({ open: jest.fn(async () => ({ ok: false as const, reason: 'desktop-only' as const })) });
      const h = setup(host);
      expect(await h.call('displayWindow:open', {})).toEqual({ ok: false, reason: 'desktop-only' });
      expect(host.open).toHaveBeenCalledTimes(1);
    });

    it('closes, reports status, and returns the cached state', async () => {
      const host = fakeHost({ getState: jest.fn(() => snapshot), isOpen: jest.fn(() => false) });
      const h = setup(host);
      expect(await h.call('displayWindow:close', {})).toEqual({ closed: true });
      expect(await h.call('displayWindow:status', {})).toEqual({ supported: true, open: false });
      expect(await h.call('displayWindow:getState', {})).toEqual({ state: snapshot });
    });

    it('publishes a parsed snapshot', async () => {
      const host = fakeHost();
      const h = setup(host);
      expect(await h.call('displayWindow:publishState', snapshot)).toEqual({ delivered: true });
      expect(host.publishState).toHaveBeenCalledWith(snapshot);
    });

    const actions: readonly DisplayWindowAction[] = [
      { type: 'select', key: 'artifact:abc' },
      { type: 'fullscreen-closed' },
      { type: 'view-state', surfaceKey: 'surface:1', viewState: { zoom: 2, open: [1, 2] } },
      { type: 'open-file', path: 'src/a.ts' },
      { type: 'review' },
      { type: 'attach' },
    ];

    it.each(actions)('relays the $type action', async (action) => {
      const host = fakeHost();
      const h = setup(host);
      expect(await h.call('displayWindow:action', { tabId: 'tab-a', action })).toEqual({ relayed: true });
      expect(host.relayAction).toHaveBeenCalledWith('tab-a', action);
    });
  });

  describe('without a bound host', () => {
    it('answers not-ready and every negative value', async () => {
      const h = setup();
      expect(await h.call('displayWindow:open', {})).toEqual({ ok: false, reason: 'not-ready' });
      expect(await h.call('displayWindow:close', {})).toEqual({ closed: false });
      expect(await h.call('displayWindow:status', {})).toEqual({ supported: false, open: false });
      expect(await h.call('displayWindow:publishState', snapshot)).toEqual({ delivered: false });
      expect(await h.call('displayWindow:getState', {})).toEqual({ state: null });
      expect(await h.call('displayWindow:action', { tabId: 'tab-a', action: { type: 'review' } }))
        .toEqual({ relayed: false });
      expect(h.container.resolve).not.toHaveBeenCalled();
    });
  });

  describe('param validation', () => {
    it.each(['displayWindow:open', 'displayWindow:close', 'displayWindow:status', 'displayWindow:getState'])(
      '%s rejects unknown keys and non-objects', async (method) => {
        const host = fakeHost();
        const h = setup(host);
        await expect(h.call(method, { extra: 1 })).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
        await expect(h.call(method, 'x')).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
        expect(host.open).not.toHaveBeenCalled();
        expect(host.close).not.toHaveBeenCalled();
      },
    );

    it.each([
      { ...snapshot, extra: true },
      { ...snapshot, tabId: '' },
      { ...snapshot, revision: -1 },
      { ...snapshot, revision: 1.5 },
      { ...snapshot, state: [] },
      { ...snapshot, state: { bad: undefined } },
      { tabId: 'tab-a', revision: 1 },
    ])('publishState rejects malformed params %#', async (params) => {
      const host = fakeHost();
      const h = setup(host);
      await expect(h.call('displayWindow:publishState', params)).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(host.publishState).not.toHaveBeenCalled();
    });

    it('refuses a state larger than the 4 MiB cap without forwarding it', async () => {
      const host = fakeHost();
      const h = setup(host);
      const big = { ...snapshot, state: { blob: 'x'.repeat(DISPLAY_WINDOW_STATE_MAX_BYTES) } };
      await expect(h.call('displayWindow:publishState', big)).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(host.publishState).not.toHaveBeenCalled();
      expect(h.logger.warn).toHaveBeenCalled();
    });

    it.each([
      { tabId: 'tab-a', action: { type: 'unknown' } },
      { tabId: 'tab-a', action: { type: 'select' } },
      { tabId: 'tab-a', action: { type: 'select', key: 'k', extra: 1 } },
      { tabId: 'tab-a', action: { type: 'open-file', path: '' } },
      { tabId: 'tab-a', action: { type: 'view-state', surfaceKey: 's', viewState: 'x' } },
      { tabId: '', action: { type: 'review' } },
      { tabId: 'tab-a', action: { type: 'review' }, extra: 1 },
    ])('action rejects malformed params %#', async (params) => {
      const host = fakeHost();
      const h = setup(host);
      await expect(h.call('displayWindow:action', params)).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(host.relayAction).not.toHaveBeenCalled();
    });
  });
});
