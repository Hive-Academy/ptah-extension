/**
 * ConnectorActionsTracker specs — the page-side answers to the two Batch 6
 * follow-ups, plus per-connector error attribution on completion.
 *
 * Built on the REAL `ConnectorLinksStore` (only the RPC is mocked), so the
 * follow-ups are pinned against the store's actual behaviour: its re-read
 * after a refused setup, and its silent five-minute poll deadline.
 */

import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  PTAH_CONNECTORS,
  type PtahConnector,
  type SmitheryConnectionSummary,
} from '@ptah-extension/shared';

import { ConnectorLinksStore } from '../../data/connector-links.store';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import { ConnectorActionsTracker } from './connector-actions';

function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess(): boolean {
      return true;
    },
  };
}

function fail(error: string) {
  return {
    success: false,
    data: undefined,
    error,
    isSuccess(): boolean {
      return false;
    },
  };
}

function connectorById(id: string): PtahConnector {
  const found = PTAH_CONNECTORS.find((c) => c.id === id);
  if (!found) throw new Error(`Catalog entry '${id}' is missing`);
  return found;
}

const SENTRY = connectorById('sentry'); // oauth-dcr
const GITHUB = connectorById('github'); // oauth-app
const HUBSPOT_SMITHERY = connectorById('hubspot-smithery'); // smithery
const LINEAR = connectorById('linear'); // oauth-dcr

function hubspotConnection(
  overrides: Partial<SmitheryConnectionSummary> = {},
): SmitheryConnectionSummary {
  return {
    connectionId: 'hubspot',
    name: 'HubSpot',
    server: 'hubspot',
    status: 'auth_required',
    managedByPtah: true,
    serverKey: 'smithery_hubspot',
    ...overrides,
  };
}

describe('ConnectorActionsTracker', () => {
  let responders: Map<string, (params: unknown) => unknown>;
  let calls: string[];
  let injector: EnvironmentInjector;
  let links: ConnectorLinksStore;
  let tracker: ConnectorActionsTracker;
  let inventory: { notifyContentChanged: jest.Mock };

  const setResponder = (
    method: string,
    factory: (params: unknown) => unknown,
  ): void => {
    responders.set(method, factory);
  };
  const setSmithery = (connections: SmitheryConnectionSummary[]): void =>
    setResponder('mcpDirectory:listSmitheryConnections', () =>
      ok({ connections, namespace: 'acme' }),
    );

  beforeEach(async () => {
    responders = new Map();
    calls = [];
    inventory = { notifyContentChanged: jest.fn() };
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setSmithery([]);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ClaudeRpcService,
          useValue: {
            call: jest.fn((method: string, params: unknown) => {
              calls.push(method);
              const factory = responders.get(method);
              return Promise.resolve(
                factory ? factory(params) : fail(`No responder for ${method}`),
              );
            }),
          },
        },
        { provide: MarketplaceInventoryStore, useValue: inventory },
      ],
    });
    injector = createEnvironmentInjector(
      [ConnectorLinksStore, ConnectorActionsTracker],
      TestBed.inject(EnvironmentInjector),
    );
    links = injector.get(ConnectorLinksStore);
    tracker = injector.get(ConnectorActionsTracker);
    await links.ensure();
  });

  afterEach(() => {
    injector.destroy();
    jest.useRealTimers();
  });

  describe('action errors', () => {
    it('pins a failure to its connector and the place it was pressed', async () => {
      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: false, error: 'Consent was denied' }),
      );

      const outcome = await tracker.run('connect', SENTRY, 'featured');

      expect(outcome.kind).toBe('failed');
      expect(tracker.errorFor('sentry')).toEqual({
        connectorId: 'sentry',
        message: 'Consent was denied',
        origin: 'featured',
      });
    });

    it('shows nothing for an error this page did not start', () => {
      expect(links.actionError()).toBeNull();
      expect(tracker.actionErrors()).toEqual([]);
    });

    it('attributes overlapping failures by completion, each to its own connector', async () => {
      const pending = new Map<string, (value: unknown) => void>();
      setResponder(
        'mcpDirectory:connectOAuth',
        (params) =>
          new Promise((resolve) => {
            const url = (params as { serverUrl: string }).serverUrl;
            pending.set(url, resolve);
          }),
      );
      const runA = tracker.run('connect', SENTRY, 'grid');
      const runB = tracker.run('connect', LINEAR, 'featured');

      // B fails first, then A.
      pending.get(LINEAR.url ?? '')?.(
        ok({ success: false, error: 'B failed' }),
      );
      await runB;
      expect(tracker.errorFor('linear')?.message).toBe('B failed');
      expect(tracker.errorFor('sentry')).toBeNull();

      pending.get(SENTRY.url ?? '')?.(
        ok({ success: false, error: 'A failed' }),
      );
      await runA;

      expect(tracker.errorFor('sentry')).toEqual({
        connectorId: 'sentry',
        message: 'A failed',
        origin: 'grid',
      });
      expect(tracker.errorFor('linear')).toEqual({
        connectorId: 'linear',
        message: 'B failed',
        origin: 'featured',
      });
    });

    it('clears one connector with dismissError and a new action, leaving others', async () => {
      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: false, error: 'nope' }),
      );
      await tracker.run('connect', SENTRY, 'grid');
      await tracker.run('connect', LINEAR, 'grid');

      tracker.dismissError('sentry');
      expect(tracker.actionErrors().map((e) => e.connectorId)).toEqual([
        'linear',
      ]);

      setResponder('mcpDirectory:connectOAuth', () => ok({ success: true }));
      await tracker.run('connect', LINEAR, 'grid');
      expect(tracker.actionErrors()).toEqual([]);
    });

    it('tells the inventory its content changed after a successful connect', async () => {
      setResponder('mcpDirectory:connectOAuth', () => ok({ success: true }));

      const outcome = await tracker.run('connect', SENTRY, 'grid');

      expect(outcome.kind).toBe('done');
      expect(inventory.notifyContentChanged).toHaveBeenCalledTimes(1);
    });

    it('passes needs-setup through for an oauth-app Connect without a call', async () => {
      const before = calls.length;

      const outcome = await tracker.run('connect', GITHUB, 'grid');

      expect(outcome.kind).toBe('needs-setup');
      expect(calls.length).toBe(before);
      expect(tracker.actionErrors()).toEqual([]);
    });
  });

  describe('Batch 6 follow-up 1 — "already connected" is not a failure', () => {
    it('shows the connected state, not an error, when setup is refused because the connection is complete', async () => {
      setSmithery([hubspotConnection()]);
      await links.reload();
      // `opened: false` with no error, and the re-read shows it connected.
      setResponder('mcpDirectory:openSmitherySetup', () =>
        ok({ opened: false }),
      );
      setSmithery([hubspotConnection({ status: 'connected' })]);

      const outcome = await tracker.run('authorize', HUBSPOT_SMITHERY, 'grid');

      expect(outcome.kind).toBe('failed');
      expect(links.linkOf(HUBSPOT_SMITHERY).status).toBe('connected');
      expect(tracker.actionErrors()).toEqual([]);
      expect(inventory.notifyContentChanged).toHaveBeenCalled();
    });

    it('still reports a refused setup when the connection is not connected', async () => {
      setSmithery([hubspotConnection()]);
      await links.reload();
      setResponder('mcpDirectory:openSmitherySetup', () =>
        ok({ opened: false }),
      );

      await tracker.run('authorize', HUBSPOT_SMITHERY, 'grid');

      expect(tracker.errorFor('hubspot-smithery')?.message).toContain(
        'Could not open the setup page',
      );
    });

    it('keeps a failed Disconnect as an error even while connected', async () => {
      setSmithery([hubspotConnection({ status: 'connected' })]);
      await links.reload();
      setResponder('mcpDirectory:uninstallSmithery', () =>
        ok({ success: false, error: 'Smithery refused' }),
      );

      await tracker.run('disconnect', HUBSPOT_SMITHERY, 'detail');

      expect(tracker.errorFor('hubspot-smithery')).toEqual({
        connectorId: 'hubspot-smithery',
        message: 'Smithery refused',
        origin: 'detail',
      });
    });
  });

  describe('Batch 6 follow-up 2 — the poll deadline becomes a state', () => {
    const startSetup = async (): Promise<void> => {
      setSmithery([hubspotConnection()]);
      await links.reload();
      setResponder('mcpDirectory:openSmitherySetup', () =>
        ok({ opened: true, setupUrl: 'https://smithery.example/setup' }),
      );
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'auth_required' }),
      );
      jest.useFakeTimers();
      const outcome = await tracker.run('authorize', HUBSPOT_SMITHERY, 'grid');
      expect(outcome.kind).toBe('awaiting-setup');
      TestBed.tick();
    };

    it('marks the connector timed out when five minutes pass without a verdict', async () => {
      await startSetup();
      expect(tracker.timedOutIds().size).toBe(0);

      // Jump to 1 ms before the deadline's last tick (see the store spec).
      jest.setSystemTime(Date.now() + 5 * 60 * 1000 - 3000 - 1);
      await jest.advanceTimersByTimeAsync(3000);
      TestBed.tick();
      expect(links.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(true);
      expect(tracker.timedOutIds().size).toBe(0);

      await jest.advanceTimersByTimeAsync(3000);
      TestBed.tick();

      expect(links.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(false);
      expect(tracker.timedOutIds().has(HUBSPOT_SMITHERY.id)).toBe(true);
    });

    it('adopts a poll it did not start (a previous page instance) and still marks its timeout', async () => {
      setSmithery([hubspotConnection()]);
      await links.reload();
      setResponder('mcpDirectory:openSmitherySetup', () =>
        ok({ opened: true, setupUrl: 'https://smithery.example/setup' }),
      );
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'auth_required' }),
      );
      jest.useFakeTimers();
      // Started on the store directly — the tracker never saw the action.
      await links.authorize(HUBSPOT_SMITHERY);
      TestBed.tick();

      jest.setSystemTime(Date.now() + 5 * 60 * 1000);
      await jest.advanceTimersByTimeAsync(3000);
      TestBed.tick();

      expect(tracker.timedOutIds().has(HUBSPOT_SMITHERY.id)).toBe(true);
    });

    it('does not mark a setup that finished connected', async () => {
      await startSetup();
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'connected' }),
      );
      setSmithery([hubspotConnection({ status: 'connected' })]);

      await jest.advanceTimersByTimeAsync(3000);
      TestBed.tick();

      expect(links.linkOf(HUBSPOT_SMITHERY).status).toBe('connected');
      expect(tracker.timedOutIds().size).toBe(0);
      expect(inventory.notifyContentChanged).toHaveBeenCalled();
    });

    it('does not mark a setup that settled on an error (the card shows the reason)', async () => {
      await startSetup();
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'error' }),
      );
      setSmithery([hubspotConnection({ status: 'error' })]);

      await jest.advanceTimersByTimeAsync(3000);
      TestBed.tick();

      expect(links.linkOf(HUBSPOT_SMITHERY).status).toBe('error');
      expect(tracker.timedOutIds().size).toBe(0);
    });

    it('clears the mark on Retry, which re-runs Authorize for an existing connection', async () => {
      await startSetup();
      jest.setSystemTime(Date.now() + 5 * 60 * 1000);
      await jest.advanceTimersByTimeAsync(3000);
      TestBed.tick();
      expect(tracker.timedOutIds().has(HUBSPOT_SMITHERY.id)).toBe(true);
      const setupCalls = calls.filter(
        (m) => m === 'mcpDirectory:openSmitherySetup',
      ).length;

      await tracker.retry(HUBSPOT_SMITHERY, 'grid');
      TestBed.tick();

      expect(tracker.timedOutIds().has(HUBSPOT_SMITHERY.id)).toBe(false);
      expect(
        calls.filter((m) => m === 'mcpDirectory:openSmitherySetup').length,
      ).toBe(setupCalls + 1);
    });

    it('can be dismissed', async () => {
      await startSetup();
      jest.setSystemTime(Date.now() + 5 * 60 * 1000);
      await jest.advanceTimersByTimeAsync(3000);
      TestBed.tick();

      tracker.dismissTimeout(HUBSPOT_SMITHERY.id);

      expect(tracker.timedOutIds().size).toBe(0);
    });
  });

  it('Retry runs Connect when no connection exists yet', async () => {
    setResponder('mcpDirectory:installSmithery', () =>
      ok({ success: false, error: 'No key' }),
    );

    await tracker.retry(HUBSPOT_SMITHERY, 'grid');

    expect(calls).toContain('mcpDirectory:installSmithery');
  });
});
