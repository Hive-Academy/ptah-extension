/**
 * SurfaceStateService: submit settlement (Req 10) and eviction pushes from
 * every store path (Req 7.2, 7.6). Agent writes, UI writes and races are in
 * `surface-state.service.spec.ts`.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  SurfaceComponent,
  SurfaceEnvelope,
  SurfacePatchOp,
  SurfaceUpdatedPayload,
} from '@ptah-extension/shared';
import type { DashboardSurfaceHost } from '../code-execution/namespace-builders/dashboard-namespace.builder';
import {
  SurfaceStateService,
  type SurfaceStateServiceOptions,
} from './surface-state.service';
import type {
  SurfaceMutationOutcome,
  SurfaceSubmitTicket,
} from './surface-ui-mutations';
import type { SurfaceAgentUpdateResult } from './surface-agent-mutations';

const NOW = 1_800_000_000_000;
const NONCE = 'nonce-0123456789abcdef';
let opCounter = 0;
function opId(): string {
  opCounter += 1;
  return `op-${NOW}-test${String(opCounter).padStart(6, '0')}`;
}

const FORM: SurfaceComponent = {
  kind: 'card',
  id: 'form',
  title: { text: 'Profile' },
  actions: [{ id: 'send', action: 'surface.submit', label: { text: 'Send' } }],
  children: [
    {
      kind: 'text',
      id: 'name',
      label: 'Name',
      path: 'form.name',
      hints: { required: true },
    },
    {
      kind: 'select',
      id: 'plan',
      label: 'Plan',
      path: 'form.plan',
      options: [
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro' },
      ],
    },
    { kind: 'checkbox', id: 'agree', label: 'Agree', path: 'form.agree' },
  ],
};
const OTHER: SurfaceComponent = {
  kind: 'section',
  id: 'other',
  title: { text: 'Other' },
  actions: [
    { id: 'send-other', action: 'surface.submit', label: { text: 'Other' } },
  ],
  children: [{ kind: 'text', id: 'note', label: 'Note', path: 'other.note' }],
};
const TABLE: SurfaceComponent = {
  kind: 'table',
  id: 'people',
  columns: [{ key: 'name', label: { text: 'Name' } }],
  rows: [['Ada'], ['Bob'], ['Cy']],
  actions: [
    { id: 'pick', action: 'dashboard.select', label: { text: 'Pick' } },
  ],
};

function envelope(
  surfaceId = 'profile',
  components: readonly SurfaceComponent[] = [FORM, OTHER, TABLE],
  dataModel: SurfaceEnvelope['dataModel'] = { form: { name: 'Ada' } },
): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2',
    surfaceId,
    title: { text: `Surface ${surfaceId}` },
    components,
    dataModel,
  };
}

/** A surface of about 20 KB, so byte-cap tests have an obvious victim. */
function bigEnvelope(surfaceId: string): SurfaceEnvelope {
  const pad: Record<string, string> = {};
  for (let index = 0; index < 10; index++) pad[`p${index}`] = 'x'.repeat(2000);
  return envelope(surfaceId, [{ kind: 'stat', id: 'n', value: 1 }], { pad });
}

function setup(options: SurfaceStateServiceOptions = {}) {
  const sent: SurfaceUpdatedPayload[] = [];
  const delivered = { ok: true };
  const enumerate = jest.fn((): readonly string[] => ['ptah.main']);
  const host: DashboardSurfaceHost = {
    getActiveWebviews: enumerate,
    sendMessage: async (_view: string, _type: string, payload: unknown) => {
      sent.push(payload as SurfaceUpdatedPayload);
      return delivered.ok;
    },
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
  const service = new SurfaceStateService(
    logger as unknown as Logger,
    { getHost: () => host },
    { clock: () => NOW, createNonce: () => NONCE, ...options },
  );
  let calls = 0;
  const agent = (
    routingId: string,
    input: Parameters<SurfaceStateService['applyAgentUpdate']>[1],
  ) => service.applyAgentUpdate(routingId, input, `call-${++calls}`);
  const create = (routingId: string, surface = envelope()) =>
    applied(agent(routingId, { operation: 'create', surface }));
  const patch = (
    routingId: string,
    baseRevision: number,
    ops: readonly SurfacePatchOp[],
    surfaceId = 'profile',
  ) => agent(routingId, { operation: 'patch', surfaceId, baseRevision, ops });
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    service,
    sent,
    enumerate,
    logger,
    delivered,
    agent,
    create,
    patch,
    flush,
  };
}

function applied(result: SurfaceAgentUpdateResult) {
  if (result.status !== 'applied')
    throw new Error(`expected applied, got ${result.status}`);
  return result;
}

function revisionOf(
  service: SurfaceStateService,
  routingId: string,
  surfaceId = 'profile',
) {
  const read = service.read(routingId, surfaceId);
  return read.status === 'found' ? read.surfaces[0].revision : undefined;
}

function viewOf(
  service: SurfaceStateService,
  routingId: string,
  surfaceId = 'profile',
) {
  const read = service.read(routingId, surfaceId);
  if (read.status !== 'found') throw new Error('surface not found');
  return read.surfaces[0];
}

function change(
  service: SurfaceStateService,
  routingId: string,
  revision: number,
  value: string | boolean | null,
  componentId = 'name',
  operationId = opId(),
): SurfaceMutationOutcome {
  return service.change(routingId, {
    surfaceId: 'profile',
    revision,
    operationId,
    componentId,
    value,
  });
}

function ticketOf(
  begin: ReturnType<SurfaceStateService['beginSubmit']>,
): SurfaceSubmitTicket {
  if (begin.status !== 'dispatch')
    throw new Error(`expected dispatch, got ${begin.status}`);
  return begin.ticket;
}

describe('SurfaceStateService - submit (Req 10)', () => {
  function ready() {
    const t = setup();
    t.create('tab-1');
    change(t.service, 'tab-1', 1, 'Grace');
    return t;
  }
  const begin = (
    t: ReturnType<typeof setup>,
    revision: number,
    operationId = opId(),
    actionId = 'send',
  ) =>
    t.service.beginSubmit('tab-1', {
      surfaceId: 'profile',
      revision,
      operationId,
      actionId,
    });

  it('freezes only the invoked scope, stays pending until settled, and writes the last submit once', async () => {
    const t = ready();
    const operationId = opId();
    const ticket = ticketOf(begin(t, 2, operationId));
    expect(Object.isFrozen(ticket) && Object.isFrozen(ticket.values)).toBe(
      true,
    );
    expect(ticket.values.map((v) => v.path)).toEqual([
      'form.name',
      'form.plan',
      'form.agree',
    ]);
    expect(ticket.message).toContain(`[SURFACE SUBMISSION ${NONCE}]`);
    expect(ticket.message).not.toContain('other.note');
    expect(t.service.usage().ticketBytes).toBeGreaterThan(0);
    expect(t.service.operationStatus('tab-1', operationId).status).toBe(
      'pending',
    );
    expect(begin(t, 2, operationId)).toEqual({
      status: 'pending',
      operationId,
    });
    expect(begin(t, 2)).toMatchObject({ status: 'rejected', reason: 'busy' });

    expect(t.service.settleSubmit(ticket, { status: 'applied' })).toEqual({
      status: 'applied',
      operationId,
      revision: 3,
    });
    expect(t.service.usage().ticketBytes).toBe(0);
    const view = viewOf(t.service, 'tab-1');
    expect(view.lastSubmit).toMatchObject({
      operationId,
      status: 'applied',
      scopeComponentId: 'form',
      baseRevision: 2,
      submittedAt: NOW,
    });
    expect(
      view.content.contract === 'dashboard-spec/2' && view.content.dataModel,
    ).toEqual({ form: { name: 'Grace' } });
    // A second settlement returns the record and writes nothing.
    expect(
      t.service.settleSubmit(ticket, {
        status: 'indeterminate',
        detail: 'late',
      }),
    ).toEqual({ status: 'applied', operationId, revision: 3 });
    expect(begin(t, 2, operationId)).toEqual({
      status: 'applied',
      operationId,
      revision: 3,
    });
    await t.flush();
    expect(t.sent[t.sent.length - 1]).toMatchObject({
      origin: 'host',
      revision: 3,
      change: { kind: 'ops', ops: [{ op: 'set-last-submit' }] },
    });
  });

  it('records indeterminate with a revision, and a dispatch rejection with no change', () => {
    const t = ready();
    const first = ticketOf(begin(t, 2));
    expect(
      t.service.settleSubmit(first, {
        status: 'indeterminate',
        detail: 'send threw',
      }),
    ).toMatchObject({ status: 'indeterminate', revision: 3 });
    expect(viewOf(t.service, 'tab-1').lastSubmit?.status).toBe('indeterminate');
    const second = ticketOf(begin(t, 3));
    expect(
      t.service.settleSubmit(second, {
        status: 'rejected',
        reason: 'busy',
        detail: 'turn running',
      }),
    ).toMatchObject({ status: 'rejected', reason: 'busy' });
    expect(revisionOf(t.service, 'tab-1')).toBe(3);
  });

  it('rejects invalid, stale and undeclared submits, naming each failing path', () => {
    const t = setup();
    t.create('tab-1', envelope('profile', [FORM, OTHER, TABLE], {}));
    const invalid = begin(t, 1);
    expect(invalid).toMatchObject({
      status: 'rejected',
      reason: 'submit-invalid',
      issues: [{ path: 'form.name' }],
    });
    expect(invalid.status === 'rejected' && invalid.detail).toContain(
      'form.name',
    );
    expect(begin(t, 1, opId(), 'pick')).toMatchObject({ reason: 'undeclared' });
    expect(begin(t, 1, opId(), 'ghost')).toMatchObject({
      reason: 'undeclared',
    });
    expect(begin(t, 0)).toMatchObject({
      reason: 'stale-revision',
      currentRevision: 1,
    });
    // Only the invoked scope is checked: the optional other section submits.
    expect(begin(t, 1, opId(), 'send-other')).toMatchObject({
      status: 'dispatch',
    });
    expect(revisionOf(t.service, 'tab-1')).toBe(1);
  });

  it('settles on the same incarnation after a change or a replace, never overwriting them', () => {
    const t = ready();
    const ticket = ticketOf(begin(t, 2));
    expect(change(t.service, 'tab-1', 2, 'Hopper')).toMatchObject({
      revision: 3,
    });
    expect(t.service.settleSubmit(ticket, { status: 'applied' })).toMatchObject(
      { revision: 4 },
    );
    const view = viewOf(t.service, 'tab-1');
    expect(
      view.content.contract === 'dashboard-spec/2' && view.content.dataModel,
    ).toEqual({ form: { name: 'Hopper' } });

    const second = ticketOf(begin(t, 4));
    applied(
      t.agent('tab-1', {
        operation: 'replace',
        baseRevision: 4,
        surface: envelope(),
      }),
    );
    expect(t.service.settleSubmit(second, { status: 'applied' })).toMatchObject(
      { revision: 6 },
    );
    expect(viewOf(t.service, 'tab-1').lastSubmit?.operationId).toBe(
      second.operationId,
    );
  });

  it('settles the ledger but writes no last submit after delete-then-recreate or eviction', () => {
    const t = ready();
    const ticket = ticketOf(begin(t, 2));
    applied(
      t.agent('tab-1', {
        operation: 'delete',
        surfaceId: 'profile',
        baseRevision: 2,
      }),
    );
    t.create('tab-1');
    expect(t.service.settleSubmit(ticket, { status: 'applied' })).toEqual({
      status: 'applied',
      operationId: ticket.operationId,
    });
    expect(viewOf(t.service, 'tab-1').lastSubmit).toBeNull();
    expect(t.logger.warn).toHaveBeenCalledWith(
      '[Surface] last submit not recorded',
      expect.objectContaining({ detail: expect.stringContaining('recreated') }),
    );

    const evicting = setup({ storeLimits: { maxSurfacesPerRoutingId: 1 } });
    evicting.create('tab-1');
    const orphan = ticketOf(begin(evicting, 1, opId(), 'send-other'));
    evicting.create('tab-1', envelope('second'));
    expect(
      evicting.service.settleSubmit(orphan, {
        status: 'indeterminate',
        detail: 'x',
      }),
    ).toEqual({
      status: 'indeterminate',
      operationId: orphan.operationId,
      detail: 'x',
    });
    expect(
      evicting.service.operationStatus('tab-1', orphan.operationId).status,
    ).toBe('indeterminate');
    expect(evicting.service.read('tab-1', 'profile')).toEqual({
      status: 'not-found',
    });
  });
});

describe('SurfaceStateService - eviction pushes (Req 7.2, 7.6)', () => {
  const evictions = (sent: readonly SurfaceUpdatedPayload[]) =>
    sent.filter(
      (p) => p.change.kind === 'deleted' && p.change.reason === 'evicted',
    );

  it('pushes evictions caused by a commit, after the commit, and recreates above the high water', async () => {
    const t = setup({ storeLimits: { maxSurfacesPerRoutingId: 2 } });
    t.create('tab-1', envelope('a'));
    t.create('tab-1', envelope('b'));
    t.create('tab-1', envelope('c'));
    await t.flush();
    expect(evictions(t.sent)).toEqual([
      expect.objectContaining({ surfaceId: 'a', origin: 'host', revision: 3 }),
    ]);
    expect(t.sent.map((p) => `${p.surfaceId}:${p.change.kind}`)).toEqual([
      'a:snapshot',
      'b:snapshot',
      'c:snapshot',
      'a:deleted',
    ]);
    expect(t.service.read('tab-1', 'a')).toEqual({ status: 'not-found' });
    expect(t.create('tab-1', envelope('a')).revision).toBe(4);
  });

  /** Accounted bytes of a big surface `a` plus the `profile` surface. */
  function probe(withTicket: boolean) {
    const p = setup();
    p.create('tab-1', bigEnvelope('a'));
    p.create('tab-1');
    const base = p.service.usage().totalBytes;
    if (!withTicket) return { base, ticket: 0 };
    ticketOf(
      p.service.beginSubmit('tab-1', {
        surfaceId: 'profile',
        revision: 2,
        operationId: opId(),
        actionId: 'send-other',
      }),
    );
    return { base, ticket: p.service.usage().ticketBytes };
  }

  it('pushes evictions caused by the ledger admission (makeRoom) before the commit push', async () => {
    const { base } = probe(false);
    const t = setup({ storeLimits: { maxStoreBytes: base + 512 } });
    t.create('tab-1', bigEnvelope('a'));
    t.create('tab-1');
    expect(change(t.service, 'tab-1', 2, 'Grace')).toMatchObject({
      status: 'applied',
      revision: 3,
    });
    await t.flush();
    expect(
      t.sent.slice(-2).map((p) => `${p.surfaceId}:${p.change.kind}`),
    ).toEqual(['a:deleted', 'profile:ops']);
    expect(evictions(t.sent)).toHaveLength(1);
    expect(t.service.usage().totalBytes).toBeLessThanOrEqual(base + 512);
  });

  it('pushes evictions caused by a submit ticket reservation (reserveTicket)', async () => {
    const { base, ticket } = probe(true);
    expect(ticket).toBeGreaterThan(0);
    const t = setup({
      storeLimits: { maxStoreBytes: base + 1024 + ticket - 1 },
    });
    t.create('tab-1', bigEnvelope('a'));
    t.create('tab-1');
    const begun = t.service.beginSubmit('tab-1', {
      surfaceId: 'profile',
      revision: 2,
      operationId: opId(),
      actionId: 'send-other',
    });
    expect(begun.status).toBe('dispatch');
    await t.flush();
    expect(evictions(t.sent)).toEqual([
      expect.objectContaining({ surfaceId: 'a' }),
    ]);
    expect(t.service.read('tab-1', 'a')).toEqual({ status: 'not-found' });
    expect(t.create('tab-1', envelope('fresh')).revision).toBe(3);
  });
});
