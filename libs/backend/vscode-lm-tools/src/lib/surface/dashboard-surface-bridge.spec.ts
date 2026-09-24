import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { jsonUtf8Bytes } from '@ptah-extension/platform-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { makeDashboardSpec } from '@ptah-extension/shared/testing';
import { validateSurfaceUpdateInput } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { SurfaceStateService } from './surface-state.service';
import { createDashboardSurfaceBridge } from './dashboard-surface-bridge';
import { buildDashboardNamespace } from '../code-execution/namespace-builders/dashboard-namespace.builder';

function setup(delivered = true) {
  const sendMessage = jest.fn(async () => delivered);
  const service = new SurfaceStateService(
    { info: jest.fn(), warn: jest.fn(), debug: jest.fn() } as unknown as Logger,
    { getHost: () => ({ getActiveWebviews: () => ['main'], sendMessage }) },
  );
  const bridge = createDashboardSurfaceBridge(service);
  const propose = (sessionId?: string, revision = 9) =>
    bridge(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, {
      sessionId,
      spec: makeDashboardSpec({ specId: 'summary', revision }),
      toolCallId: 'call-1',
    });
  return { service, sendMessage, propose };
}

describe('createDashboardSurfaceBridge', () => {
  it('upserts repeated proposals with host revisions and preserves decreasing agent revisions', async () => {
    const { service, sendMessage, propose } = setup();
    await expect(propose('tab-a')).resolves.toEqual({
      status: 'delivered',
      surfaces: 1,
    });
    await propose('tab-a');
    await propose('tab-a', 2);
    expect(service.read('tab-a', 'v1:summary')).toMatchObject({
      status: 'found',
      surfaces: [
        {
          surfaceId: 'v1:summary',
          revision: 3,
          content: {
            contract: 'dashboard-spec/1',
            spec: makeDashboardSpec({ specId: 'summary', revision: 2 }),
          },
        },
      ],
    });
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenLastCalledWith(
      'main',
      MESSAGE_TYPES.SURFACE_UPDATED,
      expect.objectContaining({
        routingId: 'tab-a',
        surfaceId: 'v1:summary',
        revision: 3,
        toolCallId: 'call-1',
      }),
    );
  });

  it('keeps the same spec id separate across tabs', async () => {
    const { service, propose } = setup();
    await propose('tab-a', 9);
    await propose('tab-b', 4);
    for (const [tab, revision] of [
      ['tab-a', 9],
      ['tab-b', 4],
    ] as const) {
      expect(service.read(tab, 'v1:summary')).toMatchObject({
        status: 'found',
        surfaces: [{ content: { spec: { revision } } }],
      });
    }
  });

  it('rejects a v2 attempt to collide with the v1 id without changing its state', async () => {
    const { service, propose, sendMessage } = setup();
    await propose('tab-a');
    const before = service.read('tab-a');
    const result = validateSurfaceUpdateInput(
      { operation: 'delete', surfaceId: 'v1:summary', baseRevision: 1 },
      jsonUtf8Bytes,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining('ptah_dashboard_propose_spec'),
    });
    expect(service.read('tab-a')).toEqual(before);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('stores and pushes nothing for anonymous callers', async () => {
    const { service, propose, sendMessage } = setup();
    const record = jest.spyOn(service, 'recordV1Proposal');
    await expect(propose()).resolves.toEqual({ status: 'no-surface' });
    expect(record).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('returns failed delivery while retaining the proposal', async () => {
    const { service, propose } = setup(false);
    await expect(propose('tab-a')).resolves.toMatchObject({
      status: 'failed',
      delivered: 0,
      surfaces: 1,
    });
    expect(service.read('tab-a')).toMatchObject({ status: 'found' });
  });

  it('reports a refused store commit as rejected, with no delivery or resend guidance', async () => {
    const sendMessage = jest.fn(async () => true);
    const service = new SurfaceStateService(
      {
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      } as unknown as Logger,
      { getHost: () => ({ getActiveWebviews: () => ['main'], sendMessage }) },
      { storeLimits: { maxStoreBytes: 1 } },
    );
    const bridge = createDashboardSurfaceBridge(service);
    const spec = makeDashboardSpec();
    const refusal = await bridge(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, {
      sessionId: 'tab-a',
      toolCallId: 'call-1',
      spec,
    });
    expect(refusal).toMatchObject({
      status: 'refused',
      reason: expect.stringContaining('at most 1 bytes'),
    });
    if (refusal.status !== 'refused') throw new Error('expected store refusal');
    const namespace = buildDashboardNamespace({
      broadcast: bridge,
      logger: {
        info: () => {
          throw new Error('log closed');
        },
        warn: () => {
          throw new Error('log closed');
        },
      },
    });
    const result = await namespace.proposeSpec(spec, {
      sessionId: 'tab-a',
      toolCallId: 'call-2',
    });
    expect(result).toEqual({
      status: 'rejected',
      reason: `Dashboard spec ${spec.specId} revision ${spec.revision} was rejected and was not stored: ${refusal.reason}. Nothing was sent to the UI.`,
    });
    expect(service.read('tab-a')).toEqual({ status: 'not-found' });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
