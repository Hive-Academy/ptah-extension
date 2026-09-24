/**
 * SurfaceStateService under dependency failure (Batch 10 review, revision 1):
 * F1, a logger that throws synchronously (the real `Logger` rethrows output
 * channel write failures) must not interrupt any transition; F2, a submit
 * admitted under a tight byte cap must still record its last submit on the
 * live surface.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  SurfaceComponent,
  SurfaceEnvelope,
  SurfaceUpdatedPayload,
} from '@ptah-extension/shared';
import type { DashboardSurfaceHost } from '../code-execution/namespace-builders/dashboard-namespace.builder';
import {
  SurfaceStateService,
  type SurfaceStateServiceOptions,
} from './surface-state.service';
import type { SurfaceSubmitTicket } from './surface-ui-mutations';

const NOW = 1_800_000_000_000;
let counter = 0;
function opId(): string {
  counter += 1;
  return `op-${NOW}-review${String(counter).padStart(6, '0')}`;
}

const FORM: SurfaceComponent = {
  kind: 'card',
  id: 'form',
  title: { text: 'Form' },
  actions: [{ id: 'send', action: 'surface.submit', label: { text: 'Send' } }],
  children: [{ kind: 'text', id: 'name', label: 'Name', path: 'name' }],
};

function envelope(
  surfaceId = 'profile',
  components: readonly SurfaceComponent[] = [FORM],
): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2',
    surfaceId,
    title: { text: 'S' },
    components,
    dataModel: {},
  };
}

function setup(options: SurfaceStateServiceOptions = {}) {
  const sent: SurfaceUpdatedPayload[] = [];
  const failing = { on: false };
  const write = () => {
    if (failing.on) throw new Error('output channel write failed');
  };
  const logger = { info: write, warn: write, debug: write, error: write };
  const host: DashboardSurfaceHost = {
    getActiveWebviews: () => ['ptah.main'],
    sendMessage: async (_view: string, _type: string, payload: unknown) => {
      sent.push(payload as SurfaceUpdatedPayload);
      return true;
    },
  };
  const service = new SurfaceStateService(
    logger as unknown as Logger,
    { getHost: () => host },
    {
      clock: () => NOW,
      createNonce: () => 'nonce-0123456789abcdef',
      ...options,
    },
  );
  let calls = 0;
  const create = (surface = envelope()) => {
    const result = service.applyAgentUpdate(
      'tab',
      { operation: 'create', surface },
      `call-${++calls}`,
    );
    if (result.status !== 'applied') throw new Error(result.status);
    return result;
  };
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  return { service, sent, failing, create, flush };
}

function ticketOf(
  begin: ReturnType<SurfaceStateService['beginSubmit']>,
): SurfaceSubmitTicket {
  if (begin.status !== 'dispatch')
    throw new Error(`expected dispatch, got ${begin.status}`);
  return begin.ticket;
}

function view(service: SurfaceStateService, surfaceId = 'profile') {
  const read = service.read('tab', surfaceId);
  if (read.status !== 'found') throw new Error('not found');
  return read.surfaces[0];
}

describe('SurfaceStateService - a throwing logger never interrupts a transition (F1)', () => {
  it('completes a change: committed revision, terminal status, one push', async () => {
    const t = setup();
    t.create();
    t.failing.on = true;
    const operationId = opId();
    const request = {
      surfaceId: 'profile',
      revision: 1,
      operationId,
      componentId: 'name',
      value: 'Grace',
    };
    expect(t.service.change('tab', request)).toEqual({
      status: 'applied',
      operationId,
      revision: 2,
    });
    expect(t.service.operationStatus('tab', operationId)).toEqual({
      status: 'applied',
      revision: 2,
    });
    expect(t.service.change('tab', request)).toMatchObject({ revision: 2 });
    expect(
      t.service.change('tab', {
        ...request,
        revision: 2,
        operationId: opId(),
        value: 7,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'invalid-value' });
    await t.flush();
    expect(t.sent.map((p) => p.revision)).toEqual([1, 2]);
  });

  it('returns the submit ticket, then settles it, releasing its bytes', async () => {
    const t = setup();
    t.create();
    t.failing.on = true;
    const operationId = opId();
    const ticket = ticketOf(
      t.service.beginSubmit('tab', {
        surfaceId: 'profile',
        revision: 1,
        operationId,
        actionId: 'send',
      }),
    );
    expect(t.service.usage().ticketBytes).toBeGreaterThan(0);
    expect(t.service.settleSubmit(ticket, { status: 'applied' })).toEqual({
      status: 'applied',
      operationId,
      revision: 2,
    });
    expect(t.service.operationStatus('tab', operationId).status).toBe(
      'applied',
    );
    expect(t.service.usage().ticketBytes).toBe(0);
    expect(view(t.service).lastSubmit?.status).toBe('applied');
    // Not permanently busy: the next submit dispatches.
    expect(
      t.service.beginSubmit('tab', {
        surfaceId: 'profile',
        revision: 2,
        operationId: opId(),
        actionId: 'send',
      }).status,
    ).toBe('dispatch');
    await t.flush();
    expect(t.sent.map((p) => p.revision)).toEqual([1, 2]);
  });

  it('settles an orphaned submit terminally', () => {
    const t = setup();
    t.create();
    const ticket = ticketOf(
      t.service.beginSubmit('tab', {
        surfaceId: 'profile',
        revision: 1,
        operationId: opId(),
        actionId: 'send',
      }),
    );
    t.failing.on = true;
    t.service.applyAgentUpdate(
      'tab',
      { operation: 'delete', surfaceId: 'profile', baseRevision: 1 },
      'call-del',
    );
    expect(
      t.service.settleSubmit(ticket, { status: 'indeterminate', detail: 'x' }),
    ).toEqual({
      status: 'indeterminate',
      operationId: ticket.operationId,
      detail: 'x',
    });
    expect(t.service.operationStatus('tab', ticket.operationId).status).toBe(
      'indeterminate',
    );
    expect(t.service.usage().ticketBytes).toBe(0);
  });

  it('pushes every eviction when the eviction log line fails', async () => {
    const t = setup({ storeLimits: { maxSurfacesPerRoutingId: 1 } });
    t.create(envelope('a'));
    t.failing.on = true;
    expect(t.create(envelope('b')).revision).toBe(2);
    await t.flush();
    expect(t.sent.map((p) => `${p.surfaceId}:${p.change.kind}`)).toEqual([
      'a:snapshot',
      'b:snapshot',
      'a:deleted',
    ]);
  });
});

describe('SurfaceStateService - settlement headroom under a tight byte cap (F2)', () => {
  // The reviewer's reproduction: a 128-character card id, one checkbox.
  const CARD: SurfaceComponent = {
    kind: 'card',
    id: 'a'.repeat(128),
    title: { text: 'C' },
    actions: [{ id: 'send', action: 'surface.submit', label: { text: 'S' } }],
    children: [{ kind: 'checkbox', id: 'c', label: 'C', path: 'c' }],
  };
  const surface = envelope('s', [CARD]);
  const begin = (service: SurfaceStateService, revision: number) =>
    ticketOf(
      service.beginSubmit('tab', {
        surfaceId: 's',
        revision,
        operationId: opId(),
        actionId: 'send',
      }),
    );

  it('records the last submit on the live surface at the admitted cap', () => {
    const probe = setup();
    probe.create(surface);
    begin(probe.service, 1);
    const cap = probe.service.usage().totalBytes;

    const t = setup({ storeLimits: { maxStoreBytes: cap } });
    t.create(surface);
    const ticket = begin(t.service, 1);
    expect(t.service.settleSubmit(ticket, { status: 'applied' })).toEqual({
      status: 'applied',
      operationId: ticket.operationId,
      revision: 2,
    });
    expect(view(t.service, 's')).toMatchObject({
      revision: 2,
      lastSubmit: { status: 'applied', operationId: ticket.operationId },
    });
  });

  it('keeps the guarantee through an intervening write that fills the cap', () => {
    const change = (service: SurfaceStateService) =>
      service.change('tab', {
        surfaceId: 's',
        revision: 1,
        operationId: opId(),
        componentId: 'c',
        value: true,
      });
    const probe = setup();
    probe.create(surface);
    begin(probe.service, 1);
    expect(change(probe.service)).toMatchObject({ revision: 2 });
    const cap = probe.service.usage().totalBytes;

    const t = setup({ storeLimits: { maxStoreBytes: cap } });
    t.create(surface);
    const ticket = begin(t.service, 1);
    expect(change(t.service)).toMatchObject({ revision: 2 });
    expect(
      t.service.settleSubmit(ticket, { status: 'indeterminate', detail: 'x' }),
    ).toMatchObject({ status: 'indeterminate', revision: 3 });
    expect(view(t.service, 's').lastSubmit?.status).toBe('indeterminate');
  });
});
