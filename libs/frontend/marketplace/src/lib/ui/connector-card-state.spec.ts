/** Connector card state specs: the one card rule shared by every connector surface. */

import { PTAH_CONNECTORS, type PtahConnector } from '@ptah-extension/shared';

import {
  connectorCardState,
  connectorKindText,
  connectorMeta,
  connectorPillStatus,
  type ConnectorCardInput,
} from './connector-card-state';

function connectorById(id: string): PtahConnector {
  const found = PTAH_CONNECTORS.find((c) => c.id === id);
  if (!found) throw new Error(`Catalog entry '${id}' is missing`);
  return found;
}

const SENTRY = connectorById('sentry'); // oauth-dcr, devops
const GITHUB = connectorById('github'); // oauth-app
const HUBSPOT_SMITHERY = connectorById('hubspot-smithery'); // smithery

const input = (
  overrides: Partial<ConnectorCardInput> = {},
): ConnectorCardInput => ({
  status: 'not-connected',
  busy: false,
  polling: false,
  ...overrides,
});

describe('connector card state', () => {
  it('maps connector states onto the shared status words', () => {
    expect(connectorPillStatus('connected')).toBe('connected');
    expect(connectorPillStatus('needs-auth')).toBe('needs-auth');
    expect(connectorPillStatus('error')).toBe('failed');
    expect(connectorPillStatus('not-connected')).toBeNull();
  });

  it('adds the step count to the hint of an oauth-app connector only', () => {
    const steps = GITHUB.setupSteps?.length ?? 0;
    expect(steps).toBeGreaterThan(0);
    expect(connectorKindText(GITHUB)).toBe(
      `Needs an app you create with the provider · ${steps} steps`,
    );
    expect(connectorKindText(HUBSPOT_SMITHERY)).toBe('Managed by Smithery');
    expect(connectorMeta(SENTRY)).toEqual([
      'DevOps',
      'Signs in with your browser',
    ]);
  });

  it('offers Connect and no pill or status when not connected', () => {
    const state = connectorCardState(SENTRY, input());
    expect(state.pill).toBeNull();
    expect([state.canConnect, state.canAuthorize, state.canDisconnect]).toEqual(
      [true, false, false],
    );
    expect(state.hasStatus).toBe(false);
    expect(state.hasActions).toBe(true);
  });

  it('offers Disconnect with the Connected pill when connected', () => {
    const state = connectorCardState(SENTRY, input({ status: 'connected' }));
    expect(state.pill).toBe('connected');
    expect([state.canConnect, state.canAuthorize, state.canDisconnect]).toEqual(
      [false, false, true],
    );
  });

  it('offers Authorize plus the trimmed reason on error only', () => {
    const state = connectorCardState(
      HUBSPOT_SMITHERY,
      input({ status: 'error', detail: ' Smithery reported an error. ' }),
    );
    expect(state.pill).toBe('failed');
    expect(state.canAuthorize).toBe(true);
    expect(state.detail).toBe('Smithery reported an error.');
    expect(
      connectorCardState(SENTRY, input({ status: 'needs-auth', detail: 'x' }))
        .detail,
    ).toBeNull();
  });

  it('withholds Disconnect for a connection managed elsewhere', () => {
    const state = connectorCardState(
      HUBSPOT_SMITHERY,
      input({ status: 'connected', managedElsewhere: true }),
    );
    expect(state.managedElsewhere).toBe(true);
    expect(state.canDisconnect).toBe(false);
    expect(state.hasActions).toBe(false);
  });

  it('swaps Connect for the key link on a Smithery connector with no key', () => {
    const smithery = connectorCardState(
      HUBSPOT_SMITHERY,
      input({ smitheryUnavailable: 'No Smithery API key' }),
    );
    expect([smithery.needsSmitheryKey, smithery.canConnect]).toEqual([
      true,
      false,
    ]);
    const oauth = connectorCardState(
      SENTRY,
      input({ smitheryUnavailable: 'No Smithery API key' }),
    );
    expect([oauth.needsSmitheryKey, oauth.canConnect]).toEqual([false, true]);
  });

  it('locks while busy or polling, polling first', () => {
    expect(connectorCardState(SENTRY, input({ busy: true })).activity).toBe(
      'busy',
    );
    const polling = connectorCardState(
      SENTRY,
      input({ busy: true, polling: true }),
    );
    expect([polling.activity, polling.locked]).toEqual(['polling', true]);
  });

  it('drops a timed-out mark once connected, and ignores a blank error', () => {
    expect(
      connectorCardState(HUBSPOT_SMITHERY, input({ timedOut: true })).timedOut,
    ).toBe(true);
    expect(
      connectorCardState(
        HUBSPOT_SMITHERY,
        input({ timedOut: true, status: 'connected' }),
      ).timedOut,
    ).toBe(false);
    expect(connectorCardState(SENTRY, input({ error: '  ' })).error).toBeNull();
    expect(
      connectorCardState(SENTRY, input({ error: ' boom ' })).hasStatus,
    ).toBe(true);
  });
});
