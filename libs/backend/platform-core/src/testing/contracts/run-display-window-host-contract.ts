/**
 * `runDisplayWindowHostContract` — behavioural contract for `IDisplayWindowHost`.
 *
 * One suite for both kinds of adapter. A host with `supported: false`
 * (VS Code, CLI) must answer `open` with the typed `desktop-only` result and
 * every other method with its negative value. A host with `supported: true`
 * (Electron) must open, focus, close, cache the latest snapshot and relay
 * actions.
 */

import type {
  DisplayWindowAction,
  DisplayWindowSnapshot,
} from '@ptah-extension/shared';
import type { IDisplayWindowHost } from '../../interfaces/display-window-host.interface';

export interface DisplayWindowHostContractSetup {
  createHost(): IDisplayWindowHost | Promise<IDisplayWindowHost>;
  /**
   * Actions the host delivered to the main renderer, in order. Required for
   * a supported host; an unsupported host delivers nothing.
   */
  relayed?(): ReadonlyArray<{
    readonly tabId: string;
    readonly action: DisplayWindowAction;
  }>;
  teardown?(): void | Promise<void>;
}

function snapshot(revision: number): DisplayWindowSnapshot {
  return {
    tabId: 'contract-tab',
    revision,
    state: { selected: 'summary', items: [revision, 'entry', true, null] },
  };
}

const ACTION: DisplayWindowAction = { type: 'select', key: 'summary' };

export function runDisplayWindowHostContract(
  name: string,
  setup: DisplayWindowHostContractSetup,
): void {
  describe(`IDisplayWindowHost contract — ${name}`, () => {
    let host: IDisplayWindowHost;

    beforeEach(async () => {
      host = await setup.createHost();
    });

    afterEach(async () => {
      await host.close();
      await setup.teardown?.();
    });

    it('starts closed with no cached state', () => {
      expect(typeof host.supported).toBe('boolean');
      expect(host.isOpen()).toBe(false);
      expect(host.getState()).toBeNull();
    });

    it('close resolves false when no window is open', async () => {
      await expect(host.close()).resolves.toBe(false);
    });

    it('open resolves a typed result and never rejects', async () => {
      const result = await host.open();
      if (host.supported) {
        expect(result).toEqual({ ok: true });
        expect(host.isOpen()).toBe(true);
      } else {
        expect(result).toEqual({ ok: false, reason: 'desktop-only' });
        expect(host.isOpen()).toBe(false);
      }
    });

    it('open on an open window focuses it and keeps it open', async () => {
      await host.open();
      const second = await host.open();
      expect(second.ok).toBe(host.supported);
      expect(host.isOpen()).toBe(host.supported);
    });

    it('close closes an open window once', async () => {
      await host.open();
      await expect(host.close()).resolves.toBe(host.supported);
      expect(host.isOpen()).toBe(false);
      await expect(host.close()).resolves.toBe(false);
    });

    it('publishState caches the latest snapshot only on a supported host', async () => {
      await host.open();
      expect(host.publishState(snapshot(1))).toBe(host.supported);
      expect(host.publishState(snapshot(2))).toBe(host.supported);
      expect(host.getState()).toEqual(host.supported ? snapshot(2) : null);
    });

    it('relayAction delivers only on a supported host', async () => {
      await host.open();
      const relayed = host.relayAction('contract-tab', ACTION);
      expect(relayed).toBe(host.supported);
      if (host.supported) {
        expect(setup.relayed).toBeDefined();
        expect(setup.relayed?.()).toEqual([
          { tabId: 'contract-tab', action: ACTION },
        ]);
      } else {
        expect(setup.relayed?.() ?? []).toEqual([]);
      }
    });
  });
}
