import 'reflect-metadata';
import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { LibraryChangedPayload } from '@ptah-extension/shared';
import { broadcastLibraryChanged } from './library-change-broadcaster';

const PAYLOAD: LibraryChangedPayload = {
  workspaceRoot: '/tmp/ws',
  status: 'updated',
  reasons: ['activation', 'harness-propagation'],
};

function makeContainer(
  entries: Array<[unknown, unknown]>,
): DependencyContainer {
  const map = new Map<unknown, unknown>(entries);
  return {
    isRegistered: (token: unknown) => map.has(token),
    resolve: (token: unknown) => {
      if (!map.has(token)) throw new Error(`not registered: ${String(token)}`);
      return map.get(token);
    },
  } as unknown as DependencyContainer;
}

describe('broadcastLibraryChanged', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('broadcasts the payload under library:changed', () => {
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);

    broadcastLibraryChanged(
      makeContainer([[TOKENS.WEBVIEW_MANAGER, { broadcastMessage }]]),
      PAYLOAD,
    );

    expect(broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.LIBRARY_CHANGED,
      PAYLOAD,
    );
  });

  it('does nothing and does not throw when WEBVIEW_MANAGER is absent', () => {
    const container = makeContainer([]);
    const resolve = jest.spyOn(container, 'resolve');

    expect(() => broadcastLibraryChanged(container, PAYLOAD)).not.toThrow();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('swallows a synchronous throw from the manager', () => {
    const broadcastMessage = jest.fn(() => {
      throw new Error('window destroyed');
    });

    expect(() =>
      broadcastLibraryChanged(
        makeContainer([[TOKENS.WEBVIEW_MANAGER, { broadcastMessage }]]),
        PAYLOAD,
      ),
    ).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(
      '[Ptah Electron] library:changed broadcast failed (non-fatal):',
      'window destroyed',
    );
  });

  it('swallows a rejected broadcast without an unhandled rejection', async () => {
    const broadcastMessage = jest
      .fn()
      .mockRejectedValue(new Error('renderer gone'));

    broadcastLibraryChanged(
      makeContainer([[TOKENS.WEBVIEW_MANAGER, { broadcastMessage }]]),
      PAYLOAD,
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(console.warn).toHaveBeenCalledWith(
      '[Ptah Electron] library:changed broadcast rejected (non-fatal):',
      'renderer gone',
    );
  });
});
