import 'reflect-metadata';
import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { BootReadinessChangedPayload } from '@ptah-extension/shared';
import { createBootReadinessBroadcaster } from './boot-readiness-broadcaster';

const PAYLOAD: BootReadinessChangedPayload = {
  readiness: 'warming',
  phase: 'database',
  detail: 'Opening the database',
  startedAt: 1_700_000_000_000,
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

describe('createBootReadinessBroadcaster', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('broadcasts the payload under boot:readinessChanged', () => {
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);
    const emit = createBootReadinessBroadcaster(
      makeContainer([[TOKENS.WEBVIEW_MANAGER, { broadcastMessage }]]),
    );

    emit(PAYLOAD);

    expect(broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.BOOT_READINESS_CHANGED,
      PAYLOAD,
    );
  });

  it('resolves WEBVIEW_MANAGER lazily, per emit', () => {
    // The manager is registered in `bootstrap.ts`, and the broadcaster may be
    // built before that. Resolving once at construction would capture the
    // absence permanently.
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);
    const container = makeContainer([]);
    const resolve = jest.spyOn(container, 'resolve');
    const emit = createBootReadinessBroadcaster(container);

    emit(PAYLOAD);
    expect(resolve).not.toHaveBeenCalled();

    // Now the manager appears.
    jest.spyOn(container, 'isRegistered').mockReturnValue(true);
    resolve.mockReturnValue({ broadcastMessage });
    emit(PAYLOAD);

    expect(broadcastMessage).toHaveBeenCalledTimes(1);
  });

  it('does nothing and does not throw when WEBVIEW_MANAGER is absent', () => {
    const emit = createBootReadinessBroadcaster(makeContainer([]));

    expect(() => emit(PAYLOAD)).not.toThrow();
  });

  it('swallows a synchronous throw from the manager', () => {
    const emit = createBootReadinessBroadcaster(
      makeContainer([
        [
          TOKENS.WEBVIEW_MANAGER,
          {
            broadcastMessage: () => {
              throw new Error('window is gone');
            },
          },
        ],
      ]),
    );

    expect(() => emit(PAYLOAD)).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });

  it('swallows a rejected broadcast rather than leaking an unhandled rejection', async () => {
    const broadcastMessage = jest
      .fn()
      .mockRejectedValue(new Error('ipc channel closed'));
    const emit = createBootReadinessBroadcaster(
      makeContainer([[TOKENS.WEBVIEW_MANAGER, { broadcastMessage }]]),
    );

    emit(PAYLOAD);
    await Promise.resolve();
    await Promise.resolve();

    expect(console.warn).toHaveBeenCalled();
  });
});
