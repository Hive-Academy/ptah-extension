/**
 * `startMessagingGateway` — persistence-gate specs (TASK_2026_347).
 *
 * The defect this pins is a SEQUENCE across two phases that do not know about
 * each other: `registerPostWindow` starts the gateway, and `startPostWindow`
 * opens SQLite — in that order. Everything below drives the real module against
 * a real `BootCoordinator` and stub services, so "did not start before the gate"
 * is observed rather than pattern-matched.
 *
 * This file imports no Electron API: `post-window.ts` reads `import.meta.url`
 * and cannot be required under ts-jest, which is exactly why the start body was
 * extracted into its own module.
 */

import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { GatewayService } from '@ptah-extension/messaging-gateway';
import type { GatewayChatBridge } from '@ptah-extension/gateway-chat-bridge';

import { BootCoordinator } from './boot-coordinator';
import { startMessagingGateway } from './start-messaging-gateway';

interface Harness {
  coordinator: BootCoordinator;
  gateway: GatewayService;
  bridge: GatewayChatBridge;
  broadcast: jest.Mock;
  order: string[];
  gatewayStart: jest.Mock;
  bridgeStart: jest.Mock;
  run: () => Promise<void>;
}

function makeHarness(
  overrides: {
    gatewayStart?: jest.Mock;
    bridge?: GatewayChatBridge | null;
  } = {},
): Harness {
  const order: string[] = [];

  const gatewayStart =
    overrides.gatewayStart ??
    jest.fn(async () => {
      order.push('gateway.start');
    });
  const bridgeStart = jest.fn(() => {
    order.push('bridge.start');
  });
  const broadcast = jest.fn(async (type: string) => {
    order.push(`broadcast:${type}`);
  });

  const gateway = {
    start: gatewayStart,
    status: () => ({
      enabled: true,
      adapters: [
        { platform: 'telegram', running: true },
        { platform: 'discord', running: false, lastError: 'no token' },
      ],
    }),
  } as unknown as GatewayService;

  const bridge = { start: bridgeStart } as unknown as GatewayChatBridge;
  const coordinator = new BootCoordinator();

  return {
    coordinator,
    gateway,
    bridge,
    broadcast,
    order,
    gatewayStart,
    bridgeStart,
    run: () =>
      startMessagingGateway({
        gateway,
        bridge: overrides.bridge === undefined ? bridge : overrides.bridge,
        coordinator,
        broadcast,
      }),
  };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('startMessagingGateway — the persistence gate', () => {
  it('starts NOTHING before the gate is settled', async () => {
    const h = makeHarness();
    const started = h.run();

    // Several turns, so a missing `await` would have shown by now.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.gatewayStart).not.toHaveBeenCalled();
    expect(h.bridgeStart).not.toHaveBeenCalled();

    h.coordinator.markPersistenceSettled({ sqliteOpen: true });
    await started;

    expect(h.gatewayStart).toHaveBeenCalledTimes(1);
  });

  it('starts the gateway, broadcasts status, then starts the bridge — in that order', async () => {
    const h = makeHarness();
    const started = h.run();
    h.coordinator.markPersistenceSettled({ sqliteOpen: true });
    await started;

    expect(h.order).toEqual([
      'gateway.start',
      `broadcast:${MESSAGE_TYPES.GATEWAY_STATUS_CHANGED}`,
      'bridge.start',
    ]);
  });

  it('broadcasts the adapter status, keeping lastError only where present', async () => {
    const h = makeHarness();
    const started = h.run();
    h.coordinator.markPersistenceSettled({ sqliteOpen: true });
    await started;

    expect(h.broadcast).toHaveBeenCalledWith(
      MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
      {
        status: {
          enabled: true,
          adapters: [
            { platform: 'telegram', running: true },
            { platform: 'discord', running: false, lastError: 'no token' },
          ],
        },
        origin: null,
      },
    );
  });

  it('still starts the gateway when persistence never opened, and warns', async () => {
    // A launch with no workspace root has no database and must still be
    // reachable from the chat platforms.
    const h = makeHarness();
    const started = h.run();
    h.coordinator.markPersistenceSettled({ sqliteOpen: false });
    await started;

    expect(h.gatewayStart).toHaveBeenCalledTimes(1);
    expect(h.bridgeStart).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('without persistence (degraded)'),
    );
  });

  it('starts nothing when the boot aborted before the gate settled', async () => {
    const h = makeHarness();
    const started = h.run();

    h.coordinator.abort(); // settles the gate AND raises the signal
    await started;

    expect(h.gatewayStart).not.toHaveBeenCalled();
    expect(h.bridgeStart).not.toHaveBeenCalled();
  });
});

describe('startMessagingGateway — failure containment', () => {
  it('skips the bridge and warns when the gateway start rejects', async () => {
    const h = makeHarness({
      gatewayStart: jest.fn(async () => {
        throw new Error('adapter exploded');
      }),
    });
    const started = h.run();
    h.coordinator.markPersistenceSettled({ sqliteOpen: true });

    await expect(started).resolves.toBeUndefined();

    expect(h.bridgeStart).not.toHaveBeenCalled();
    expect(h.broadcast).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Messaging gateway start skipped'),
      'adapter exploded',
    );
  });

  it('does not reject when the bridge start throws', async () => {
    const h = makeHarness();
    (h.bridge.start as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('bridge exploded');
    });

    const started = h.run();
    h.coordinator.markPersistenceSettled({ sqliteOpen: true });

    await expect(started).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Gateway chat bridge start skipped'),
      'bridge exploded',
    );
  });

  it('starts the gateway with no bridge resolved', async () => {
    const h = makeHarness({ bridge: null });
    const started = h.run();
    h.coordinator.markPersistenceSettled({ sqliteOpen: true });
    await started;

    expect(h.gatewayStart).toHaveBeenCalledTimes(1);
  });
});
