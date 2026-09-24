/**
 * SurfaceStateService: agent writes (Req 5), UI writes (Req 6, 7) and races.
 * Submit settlement and eviction pushes are in
 * `surface-state.service.submit.spec.ts`.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  DashboardSpecEnvelope,
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
import type { SurfaceMutationOutcome } from './surface-ui-mutations';
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

describe('SurfaceStateService - agent writes (Req 5)', () => {
  it('creates, patches, replaces and deletes with exactly one next revision each', async () => {
    const t = setup();
    const created = t.create('tab-1');
    expect(created.revision).toBe(1);
    expect(created.operationId).toBe('mcp:call-1');
    const patched = applied(
      t.patch('tab-1', 1, [
        { op: 'set-data', path: 'form.plan', value: 'pro' },
      ]),
    );
    expect(patched.revision).toBe(2);
    const replaced = applied(
      t.agent('tab-1', {
        operation: 'replace',
        baseRevision: 2,
        surface: envelope(),
      }),
    );
    expect(replaced.revision).toBe(3);
    const deleted = applied(
      t.agent('tab-1', {
        operation: 'delete',
        surfaceId: 'profile',
        baseRevision: 3,
      }),
    );
    expect(deleted.revision).toBe(4);
    expect(deleted.view).toBeNull();
    expect(t.service.read('tab-1', 'profile')).toEqual({ status: 'not-found' });
    expect(
      t.service.describeForAgent('tab-1', { surfaceId: 'profile' }).status,
    ).toBe('not-found');

    await t.flush();
    expect(t.sent.map((p) => [p.revision, p.change.kind, p.origin])).toEqual([
      [1, 'snapshot', 'agent'],
      [2, 'ops', 'agent'],
      [3, 'snapshot', 'agent'],
      [4, 'deleted', 'agent'],
    ]);
    expect(t.sent[1]).toMatchObject({
      routingId: 'tab-1',
      surfaceId: 'profile',
      toolCallId: 'call-2',
      operationId: 'mcp:call-2',
      change: { kind: 'ops', fromRevision: 1 },
    });
    expect(t.sent[3].change).toEqual({
      kind: 'deleted',
      reason: 'agent-deleted',
    });
  });

  it('rejects create on an existing id and keeps routing ids apart', () => {
    const t = setup();
    t.create('tab-1');
    expect(
      t.agent('tab-1', { operation: 'create', surface: envelope() }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'already-exists',
      currentRevision: 1,
    });
    // The same surface id under another routing id is another surface.
    expect(t.create('tab-2').revision).toBe(2);
    expect(revisionOf(t.service, 'tab-1')).toBe(1);
  });

  it('rejects stale, missing-id and invalid patches without changing or pushing anything', async () => {
    const t = setup();
    t.create('tab-1');
    applied(
      t.patch('tab-1', 1, [{ op: 'set-data', path: 'other.note', value: 'n' }]),
    );
    await t.flush();
    const pushes = t.sent.length;
    const before = viewOf(t.service, 'tab-1');

    // Agent writes require the exact base, even on a disjoint path (Req 5.4).
    expect(
      t.patch('tab-1', 1, [
        { op: 'set-data', path: 'form.plan', value: 'pro' },
      ]),
    ).toMatchObject({
      status: 'rejected',
      reason: 'stale-revision',
      currentRevision: 2,
    });
    const missing = t.patch('tab-1', 2, [
      { op: 'remove-component', componentId: 'ghost' },
    ]);
    expect(missing).toMatchObject({
      status: 'rejected',
      reason: 'invalid-value',
    });
    expect(missing.status === 'rejected' && missing.detail).toContain(
      '"ghost"',
    );
    // A wrong-typed value at a bound path fails full re-validation (Req 5.2).
    expect(
      t.patch('tab-1', 2, [
        { op: 'set-data', path: 'form.agree', value: 'yes' },
      ]),
    ).toMatchObject({
      status: 'rejected',
      reason: 'invalid-value',
    });
    // Over the data-model byte budget: named, and classed as budget.
    const big = Array.from({ length: 40 }, (_, index): SurfacePatchOp => ({
      op: 'set-data',
      path: `bulk.k${index}`,
      value: 'y'.repeat(2000),
    }));
    const budget = t.patch('tab-1', 2, big);
    expect(budget).toMatchObject({ status: 'rejected', reason: 'budget' });
    expect(budget.status === 'rejected' && budget.detail).toContain(
      'maxDataModelBytes',
    );
    expect(t.patch('tab-1', 2, [], 'nope')).toMatchObject({
      status: 'not-found',
      surfaceId: 'nope',
    });

    await t.flush();
    expect(t.sent).toHaveLength(pushes);
    expect(viewOf(t.service, 'tab-1')).toEqual(before);
  });

  it('starts a recreated surface above every old revision and refuses the old incarnation', () => {
    const t = setup();
    t.create('tab-1');
    applied(
      t.patch('tab-1', 1, [
        { op: 'set-data', path: 'form.plan', value: 'pro' },
      ]),
    );
    applied(
      t.agent('tab-1', {
        operation: 'delete',
        surfaceId: 'profile',
        baseRevision: 2,
      }),
    );
    const recreated = t.create('tab-1');
    expect(recreated.revision).toBe(4);
    expect(
      t.patch('tab-1', 2, [
        { op: 'set-data', path: 'form.plan', value: 'free' },
      ]),
    ).toMatchObject({
      reason: 'stale-revision',
      currentRevision: 4,
    });
    expect(change(t.service, 'tab-1', 2, 'Old')).toMatchObject({
      status: 'rejected',
      reason: 'stale-revision',
      currentRevision: 4,
    });
  });

  it('records v1 proposals at v1:<specId>, keeping the agent revision verbatim', () => {
    const t = setup();
    const spec = (revision: number): DashboardSpecEnvelope => ({
      schemaVersion: 'dashboard-spec/1',
      catalogVersion: 'dashboard-catalog/1',
      specId: 'weekly',
      revision,
      generatedAt: '2026-09-24T00:00:00Z',
      title: { text: 'Weekly' },
      components: [{ kind: 'stat', id: 'users', value: 7 }],
    });
    const first = applied(
      t.service.recordV1Proposal('tab-1', spec(5), 'call-a'),
    );
    const second = applied(
      t.service.recordV1Proposal('tab-1', spec(2), 'call-b'),
    );
    expect([first.surfaceId, first.revision, second.revision]).toEqual([
      'v1:weekly',
      1,
      2,
    ]);
    const view = viewOf(t.service, 'tab-1', 'v1:weekly');
    expect(
      view.content.contract === 'dashboard-spec/1' &&
        view.content.spec.revision,
    ).toBe(2);
    expect(
      applied(t.service.recordV1Proposal('tab-2', spec(5), 'call-c')).revision,
    ).toBe(3);
  });
});

describe('SurfaceStateService - UI writes (Req 6, 7)', () => {
  it('commits a change at the bound path, pushes ops with origin ui, and never adds a revision on replay', async () => {
    const t = setup();
    t.create('tab-1');
    const operationId = opId();
    expect(change(t.service, 'tab-1', 1, 'Grace', 'name', operationId)).toEqual(
      {
        status: 'applied',
        operationId,
        revision: 2,
      },
    );
    expect(change(t.service, 'tab-1', 1, 'Grace', 'name', operationId)).toEqual(
      {
        status: 'applied',
        operationId,
        revision: 2,
      },
    );
    expect(
      change(t.service, 'tab-1', 1, 'Other', 'name', operationId),
    ).toMatchObject({
      status: 'rejected',
      reason: 'operation-conflict',
    });
    const view = viewOf(t.service, 'tab-1');
    expect(view.revision).toBe(2);
    expect(
      view.content.contract === 'dashboard-spec/2' && view.content.dataModel,
    ).toEqual({ form: { name: 'Grace' } });
    expect(t.service.operationStatus('tab-1', operationId)).toEqual({
      status: 'applied',
      revision: 2,
    });
    await t.flush();
    expect(t.sent[t.sent.length - 1]).toMatchObject({
      origin: 'ui',
      operationId,
      change: {
        kind: 'ops',
        fromRevision: 1,
        ops: [{ op: 'set-data', path: 'form.name', value: 'Grace' }],
      },
    });
    expect(t.sent[t.sent.length - 1].toolCallId).toBeUndefined();
  });

  it('rejects non-inputs, wrong types, unknown and expired operations', () => {
    const t = setup();
    t.create('tab-1');
    expect(change(t.service, 'tab-1', 1, 'x', 'people')).toMatchObject({
      reason: 'undeclared',
    });
    expect(change(t.service, 'tab-1', 1, 'gold', 'plan')).toMatchObject({
      reason: 'invalid-value',
    });
    expect(
      change(
        t.service,
        'tab-1',
        1,
        'x',
        'name',
        `op-${NOW - 700_000}-expired01`,
      ),
    ).toMatchObject({
      reason: 'operation-expired',
    });
    expect(revisionOf(t.service, 'tab-1')).toBe(1);
  });

  it('returns the same not-found for unknown routing ids and other routing ids, creating nothing', () => {
    const t = setup();
    t.create('tab-1');
    const operationId = opId();
    expect(change(t.service, 'tab-2', 1, 'x', 'name', operationId)).toEqual({
      status: 'not-found',
      operationId,
    });
    expect(t.service.operationStatus('tab-2', operationId)).toEqual({
      status: 'unknown',
    });
    expect(t.service.read('tab-2', 'profile')).toEqual({ status: 'not-found' });
    expect(t.service.read('tab-2')).toEqual({ status: 'not-found' });
    expect(
      t.service.describeForAgent('tab-2', { surfaceId: 'profile' }).status,
    ).toBe('not-found');
    expect(t.service.resolveAction('tab-2', 'profile', 'send')).toEqual({
      status: 'not-found',
    });
    expect(t.service.usage().routingIds).toBe(1);
  });

  it('accepts a UI change on an older, non-conflicting base as current + 1, never base + 1', () => {
    const t = setup();
    t.create('tab-1');
    applied(
      t.patch('tab-1', 1, [{ op: 'set-data', path: 'other.note', value: 'a' }]),
    );
    applied(
      t.patch('tab-1', 2, [
        { op: 'set-data', path: 'form.plan', value: 'pro' },
      ]),
    );
    expect(change(t.service, 'tab-1', 1, 'Grace')).toMatchObject({
      status: 'applied',
      revision: 4,
    });
  });

  it('validates selections against the host copy and clears them on structure changes (Req 5.9, 7.5)', () => {
    const t = setup();
    t.create('tab-1');
    const select = (
      revision: number,
      rowIndex: number,
      componentId = 'people',
    ) =>
      t.service.select('tab-1', {
        surfaceId: 'profile',
        revision,
        operationId: opId(),
        selection: { componentId, target: { kind: 'table-row', rowIndex } },
      });
    expect(select(1, 7)).toMatchObject({ reason: 'invalid-value' });
    expect(select(1, 0, 'name')).toMatchObject({ reason: 'undeclared' });
    expect(select(1, 2)).toMatchObject({ status: 'applied', revision: 2 });
    // A replaced table with fewer rows: the old index would select other data.
    const shorter: SurfaceComponent = {
      ...TABLE,
      rows: [['Ada']],
    } as SurfaceComponent;
    applied(
      t.patch('tab-1', 2, [{ op: 'replace-component', component: shorter }]),
    );
    expect(viewOf(t.service, 'tab-1').selection).toBeNull();
    expect(select(2, 0)).toMatchObject({
      reason: 'stale-revision',
      currentRevision: 3,
    });
    expect(select(3, 0)).toMatchObject({ status: 'applied', revision: 4 });
    applied(
      t.agent('tab-1', {
        operation: 'replace',
        baseRevision: 4,
        surface: envelope(),
      }),
    );
    expect(viewOf(t.service, 'tab-1').selection).toBeNull();
    expect(select(5, 1)).toMatchObject({ status: 'applied' });
    applied(
      t.patch('tab-1', 6, [{ op: 'remove-component', componentId: 'people' }]),
    );
    expect(viewOf(t.service, 'tab-1').selection).toBeNull();
  });
});

describe('SurfaceStateService - races (Req 5.7)', () => {
  it('UI change vs agent patch on the same path, both orders', () => {
    const uiFirst = setup();
    uiFirst.create('tab-1');
    expect(change(uiFirst.service, 'tab-1', 1, 'UI')).toMatchObject({
      revision: 2,
    });
    expect(
      uiFirst.patch('tab-1', 1, [
        { op: 'set-data', path: 'form.name', value: 'Agent' },
      ]),
    ).toMatchObject({
      reason: 'stale-revision',
      currentRevision: 2,
    });

    const agentFirst = setup();
    agentFirst.create('tab-1');
    applied(
      agentFirst.patch('tab-1', 1, [
        { op: 'set-data', path: 'form', value: { name: 'Agent' } },
      ]),
    );
    expect(change(agentFirst.service, 'tab-1', 1, 'UI')).toMatchObject({
      reason: 'stale-revision',
      currentRevision: 2,
    });
    const view = viewOf(agentFirst.service, 'tab-1');
    expect(
      view.content.contract === 'dashboard-spec/2' && view.content.dataModel,
    ).toEqual({ form: { name: 'Agent' } });
  });

  it('UI change vs replace and vs delete, both orders', () => {
    const replaceFirst = setup();
    replaceFirst.create('tab-1');
    applied(
      replaceFirst.agent('tab-1', {
        operation: 'replace',
        baseRevision: 1,
        surface: envelope(),
      }),
    );
    expect(change(replaceFirst.service, 'tab-1', 1, 'UI')).toMatchObject({
      reason: 'stale-revision',
      currentRevision: 2,
    });

    const changeThenReplace = setup();
    changeThenReplace.create('tab-1');
    expect(change(changeThenReplace.service, 'tab-1', 1, 'UI')).toMatchObject({
      revision: 2,
    });
    expect(
      changeThenReplace.agent('tab-1', {
        operation: 'replace',
        baseRevision: 1,
        surface: envelope(),
      }),
    ).toMatchObject({
      reason: 'stale-revision',
      currentRevision: 2,
    });

    const deleteFirst = setup();
    deleteFirst.create('tab-1');
    applied(
      deleteFirst.agent('tab-1', {
        operation: 'delete',
        surfaceId: 'profile',
        baseRevision: 1,
      }),
    );
    expect(change(deleteFirst.service, 'tab-1', 1, 'UI')).toMatchObject({
      status: 'not-found',
    });

    const changeThenDelete = setup();
    changeThenDelete.create('tab-1');
    expect(change(changeThenDelete.service, 'tab-1', 1, 'UI')).toMatchObject({
      revision: 2,
    });
    expect(
      changeThenDelete.agent('tab-1', {
        operation: 'delete',
        surfaceId: 'profile',
        baseRevision: 1,
      }),
    ).toMatchObject({
      reason: 'stale-revision',
      currentRevision: 2,
    });
    expect(revisionOf(changeThenDelete.service, 'tab-1')).toBe(2);
  });

  it('pushes two back-to-back commits in revision order, from inside the call', async () => {
    const t = setup();
    t.create('tab-1');
    await t.flush();
    t.sent.length = 0;
    const enumerations = t.enumerate.mock.calls.length;
    applied(
      t.patch('tab-1', 1, [
        { op: 'set-data', path: 'form.plan', value: 'pro' },
      ]),
    );
    expect(change(t.service, 'tab-1', 2, 'Grace')).toMatchObject({
      revision: 3,
    });
    // Both pushes started synchronously, before anything was awaited.
    expect(t.enumerate.mock.calls.length).toBe(enumerations + 2);
    await t.flush();
    expect(t.sent.map((p) => p.revision)).toEqual([2, 3]);
  });

  it('keeps the commit when delivery fails and reports it separately', async () => {
    const t = setup();
    t.delivered.ok = false;
    const created = t.create('tab-1');
    await expect(created.delivery).resolves.toMatchObject({
      status: 'failed',
      delivered: 0,
      surfaces: 1,
    });
    expect(revisionOf(t.service, 'tab-1')).toBe(1);
    expect(t.logger.warn).toHaveBeenCalledWith(
      '[Surface] push not delivered',
      expect.objectContaining({ revision: 1 }),
    );
  });

  it('holds a coding-tab surface (no surfaceMode) exactly like any other (Req 7.3)', () => {
    const t = setup();
    expect(t.create('coding-tab-without-surface-mode').revision).toBe(1);
    expect(
      change(t.service, 'coding-tab-without-surface-mode', 1, 'Grace'),
    ).toMatchObject({ status: 'applied' });
  });
});
