/**
 * Specs for buildDashboardNamespace — TASK_2026_493_9f58.
 *
 * This is the FIRST of the two measurement points `context.md` names: the MCP
 * tool boundary, before the broadcast. What matters here is the ordering, the
 * atomicity and the DELIVERY outcome, not the schema (the contract's own specs
 * in `libs/shared/src/mcp-apps-contracts` cover every budget and every
 * trust-boundary control):
 *
 *   - a valid spec is validated, THEN dispatched exactly once, THEN rendered;
 *   - a rejected spec dispatches NOTHING;
 *   - a spec whose delivery fails is NOT reported as success, and the failure
 *     is distinguishable from a validation rejection (revision 1, finding 2);
 *   - a host with no surface at all stays a success — that path is deliberate;
 *   - the byte check is really `jsonUtf8Bytes` from `platform-core`, not a
 *     string-length stand-in.
 */

// `@ptah-extension/vscode-core`'s barrel reaches its tsyringe-decorated DI
// registration, which needs the polyfill before the module graph is built.
import 'reflect-metadata';

import type * as vscode from 'vscode';
import { WebviewManager } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { DashboardSpecProposedPayload } from '@ptah-extension/shared';
import { DASHBOARD_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts';
import {
  makeDashboardSpec,
  makeDashboardSpecOfExactBytes,
  makeList,
  makeStat,
} from '@ptah-extension/shared/testing';
import {
  buildDashboardNamespace,
  createDashboardBroadcast,
  type DashboardDeliveryOutcome,
  type DashboardNamespace,
  type DashboardSurfaceHost,
} from './dashboard-namespace.builder';

const DELIVERED: DashboardDeliveryOutcome = {
  status: 'delivered',
  surfaces: 1,
};

interface Harness {
  namespace: DashboardNamespace;
  broadcast: jest.Mock;
  logger: { info: jest.Mock; warn: jest.Mock };
}

function makeHarness(
  delivery: DashboardDeliveryOutcome = DELIVERED,
): Harness {
  const broadcast = jest.fn(async () => delivery);
  const logger = { info: jest.fn(), warn: jest.fn() };
  return {
    broadcast,
    logger,
    namespace: buildDashboardNamespace({ broadcast, logger }),
  };
}

const CALLER = { sessionId: 'session-7', toolCallId: 'call-42' } as const;

function pushedPayload(broadcast: jest.Mock): DashboardSpecProposedPayload {
  return broadcast.mock.calls[0][1] as DashboardSpecProposedPayload;
}

describe('buildDashboardNamespace › shape', () => {
  it('exposes exactly one method', () => {
    const { namespace } = makeHarness();

    expect(Object.keys(namespace)).toEqual(['proposeSpec']);
  });
});

describe('buildDashboardNamespace › a valid spec', () => {
  it('dispatches the validated spec once, under DASHBOARD_SPEC_PROPOSED', async () => {
    const { namespace, broadcast } = makeHarness();

    const outcome = await namespace.proposeSpec(makeDashboardSpec(), CALLER);

    expect(outcome.status).toBe('accepted');
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0]).toBe(
      MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED,
    );
    expect(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED).toBe(
      'dashboard:spec-proposed',
    );
  });

  it('carries the spec, the session and the tool call id on the payload', async () => {
    const { namespace, broadcast } = makeHarness();

    await namespace.proposeSpec(makeDashboardSpec(), CALLER);
    const payload = pushedPayload(broadcast);

    expect(Object.keys(payload).sort()).toEqual([
      'sessionId',
      'spec',
      'toolCallId',
    ]);
    expect(payload.sessionId).toBe('session-7');
    expect(payload.toolCallId).toBe('call-42');
    expect(payload.spec.specId).toBe('build-health');
  });

  it('pushes an anonymous caller with no sessionId rather than inventing one', async () => {
    const { namespace, broadcast } = makeHarness();

    await namespace.proposeSpec(makeDashboardSpec(), { toolCallId: 'call-1' });

    expect(pushedPayload(broadcast).sessionId).toBeUndefined();
  });

  it('returns the plain-text dashboard, so a host with no UI has the answer', async () => {
    const { namespace } = makeHarness();

    const outcome = await namespace.proposeSpec(
      makeDashboardSpec({
        title: { text: 'Build health' },
        components: [
          makeStat({ id: 'passing', title: { text: 'Passing' }, value: 9 }),
        ],
      }),
      CALLER,
    );

    expect(outcome.status === 'accepted' && outcome.text).toContain(
      'Build health',
    );
    expect(outcome.status === 'accepted' && outcome.text).toContain(
      'Passing: 9',
    );
  });

  it('reports the measured byte size, the spec identity and the delivery outcome', async () => {
    const { namespace } = makeHarness();

    const outcome = await namespace.proposeSpec(
      makeDashboardSpec({ revision: 4 }),
      CALLER,
    );

    expect(outcome.status).toBe('accepted');
    if (outcome.status !== 'accepted') return;
    expect(outcome.specId).toBe('build-health');
    expect(outcome.revision).toBe(4);
    expect(outcome.bytes).toBeGreaterThan(0);
    expect(outcome.bytes).toBeLessThanOrEqual(DASHBOARD_LIMITS.maxSpecBytes);
    expect(outcome.delivery).toEqual(DELIVERED);
  });

  it('strips nothing and adds nothing — the pushed spec is what arrived', async () => {
    const { namespace, broadcast } = makeHarness();
    const sent = makeDashboardSpec({
      components: [makeList(['first', 'second'])],
    });

    await namespace.proposeSpec(sent, CALLER);

    expect(pushedPayload(broadcast).spec).toEqual(sent);
  });

  it('treats a host with no surface at all as a SUCCESS, not a delivery failure', async () => {
    // The deliberate CLI / headless path. `context.md` deliverable 5: the tool
    // works with no UI at all, and its text result is the whole answer.
    const { namespace } = makeHarness({ status: 'no-surface' });

    const outcome = await namespace.proposeSpec(makeDashboardSpec(), CALLER);

    expect(outcome.status).toBe('accepted');
    expect(outcome.status === 'accepted' && outcome.delivery.status).toBe(
      'no-surface',
    );
  });
});

describe('buildDashboardNamespace › a rejected spec', () => {
  it('dispatches nothing at all', async () => {
    const { namespace, broadcast } = makeHarness();

    const outcome = await namespace.proposeSpec(
      { ...makeDashboardSpec(), schemaVersion: 'dashboard-spec/99' },
      CALLER,
    );

    expect(outcome.status).toBe('rejected');
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('reports the reason and the current limits in plain text', async () => {
    const { namespace } = makeHarness();

    const outcome = await namespace.proposeSpec({ nope: true }, CALLER);

    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') return;
    expect(outcome.reason).toContain('Dashboard spec rejected');
    expect(outcome.reason).toContain('Nothing was sent to the UI.');
    expect(outcome.reason).toContain(
      `total ${DASHBOARD_LIMITS.maxSpecBytes} UTF-8 bytes`,
    );
  });

  it('rejects a non-object input without throwing', async () => {
    const { namespace, broadcast } = makeHarness();

    for (const input of [null, undefined, 'spec', 7, []]) {
      const outcome = await namespace.proposeSpec(input, CALLER);
      expect(outcome.status).toBe('rejected');
    }
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('rejects a pathologically deep spec rather than letting it throw', async () => {
    // Revision 1, finding 3, at this boundary: before the fix this produced a
    // `RangeError` that only the dispatcher's generic catch turned into an
    // error result.
    let node: Record<string, unknown> = { id: 's', kind: 'stat', value: 1 };
    for (let level = 1; level <= 999; level++) {
      node = { id: `s${level}`, kind: 'stat', value: 1, children: [node] };
    }
    const { namespace, broadcast } = makeHarness();

    const outcome = await namespace.proposeSpec(
      { ...makeDashboardSpec(), components: [node] },
      CALLER,
    );

    expect(outcome.status).toBe('rejected');
    expect(outcome.status === 'rejected' && outcome.reason).toContain(
      'levels deep',
    );
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('logs a rejection at warn and an acceptance at info', async () => {
    const { namespace, logger } = makeHarness();

    await namespace.proposeSpec({ nope: true }, CALLER);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();

    await namespace.proposeSpec(makeDashboardSpec(), CALLER);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});

describe('buildDashboardNamespace › a delivery failure (revision 1, finding 2)', () => {
  const FAILED: DashboardDeliveryOutcome = {
    status: 'failed',
    delivered: 1,
    surfaces: 2,
    reason: '1 of 2 attached surface(s) did not accept the spec',
  };

  it('is NOT reported as accepted', async () => {
    const { namespace } = makeHarness(FAILED);

    const outcome = await namespace.proposeSpec(makeDashboardSpec(), CALLER);

    expect(outcome.status).toBe('delivery-failed');
  });

  it('stays distinguishable from a validation rejection', async () => {
    const { namespace } = makeHarness(FAILED);

    const delivery = await namespace.proposeSpec(makeDashboardSpec(), CALLER);
    const validation = await namespace.proposeSpec({ nope: true }, CALLER);

    expect(delivery.status).toBe('delivery-failed');
    expect(validation.status).toBe('rejected');
    // The two carry different information on purpose: a delivery failure knows
    // the spec was valid and how much of it landed.
    expect('text' in delivery).toBe(true);
    expect('text' in validation).toBe(false);
  });

  it('still carries the dashboard text, so a transport problem does not lose the content', async () => {
    const { namespace } = makeHarness(FAILED);

    const outcome = await namespace.proposeSpec(
      makeDashboardSpec({
        title: { text: 'Build health' },
        components: [
          makeStat({ id: 'passing', title: { text: 'Passing' }, value: 9 }),
        ],
      }),
      CALLER,
    );

    expect(outcome.status).toBe('delivery-failed');
    if (outcome.status !== 'delivery-failed') return;
    expect(outcome.text).toContain('Passing: 9');
  });

  it('says how many surfaces DID receive it, because one may be on screen', async () => {
    const { namespace, logger } = makeHarness(FAILED);

    const outcome = await namespace.proposeSpec(makeDashboardSpec(), CALLER);

    expect(outcome.status).toBe('delivery-failed');
    if (outcome.status !== 'delivery-failed') return;
    expect(outcome.reason).toContain('NOT fully delivered');
    expect(outcome.reason).toContain('1 surface(s) did receive it');
    expect(outcome.delivery).toEqual(FAILED);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('createDashboardBroadcast › observed delivery (revision 1, finding 2)', () => {
  const payload = {
    spec: makeDashboardSpec(),
    toolCallId: 'call-1',
  } as DashboardSpecProposedPayload;
  const quietLogger = { debug: jest.fn() };

  function fakeHost(
    results: Readonly<Record<string, boolean>>,
  ): DashboardSurfaceHost {
    return {
      getActiveWebviews: () => Object.keys(results),
      sendMessage: async (viewType) => results[viewType] ?? false,
    };
  }

  it('reports no-surface when no host is registered', async () => {
    const broadcast = createDashboardBroadcast(() => undefined, quietLogger);

    await expect(
      broadcast(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, payload),
    ).resolves.toEqual({ status: 'no-surface' });
  });

  it('reports no-surface when a host is registered but nothing is attached', async () => {
    const broadcast = createDashboardBroadcast(() => fakeHost({}), quietLogger);

    await expect(
      broadcast(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, payload),
    ).resolves.toEqual({ status: 'no-surface' });
  });

  it('reports delivered when every attached surface accepted it', async () => {
    const broadcast = createDashboardBroadcast(
      () => fakeHost({ sidebar: true, panel: true }),
      quietLogger,
    );

    await expect(
      broadcast(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, payload),
    ).resolves.toEqual({ status: 'delivered', surfaces: 2 });
  });

  it('reports failure, and how many landed, on a partial delivery', async () => {
    const broadcast = createDashboardBroadcast(
      () => fakeHost({ sidebar: true, panel: false }),
      quietLogger,
    );

    await expect(
      broadcast(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, payload),
    ).resolves.toEqual({
      status: 'failed',
      delivered: 1,
      surfaces: 2,
      reason: '1 of 2 attached surface(s) did not accept the spec',
    });
  });

  it('attempts every surface even when an earlier one fails', async () => {
    const attempted: string[] = [];
    const host: DashboardSurfaceHost = {
      getActiveWebviews: () => ['a', 'b', 'c'],
      sendMessage: async (viewType) => {
        attempted.push(viewType);
        return viewType !== 'a';
      },
    };
    const broadcast = createDashboardBroadcast(() => host, quietLogger);

    const outcome = await broadcast(
      MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED,
      payload,
    );

    expect(attempted.sort()).toEqual(['a', 'b', 'c']);
    expect(outcome.status).toBe('failed');
  });
});

describe('createDashboardBroadcast › against the real WebviewManager', () => {
  function makeLogger(): Logger {
    return {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;
  }

  function registerSurface(
    manager: WebviewManager,
    viewType: string,
    postMessage: () => Promise<boolean>,
  ): void {
    manager.registerWebviewView(viewType, {
      visible: true,
      webview: { postMessage },
      onDidDispose: () => undefined,
      onDidChangeVisibility: () => undefined,
    } as unknown as vscode.WebviewView);
  }

  const payload = {
    spec: makeDashboardSpec(),
    toolCallId: 'call-1',
  } as DashboardSpecProposedPayload;

  it('reports delivered for a healthy surface', async () => {
    const manager = new WebviewManager(
      {} as vscode.ExtensionContext,
      makeLogger(),
    );
    registerSurface(manager, 'sidebar', async () => true);
    const broadcast = createDashboardBroadcast(() => manager, {
      debug: jest.fn(),
    });

    await expect(
      broadcast(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, payload),
    ).resolves.toEqual({ status: 'delivered', surfaces: 1 });
  });

  it('reports failure — not success — for a surface that throws during disposal, and lets nothing escape', async () => {
    // The reviewer's exact reproduction. Against the previous wiring
    // (`void webviewManager.broadcastMessage(...)`) this produced
    // "delivery failure outcome accepted" followed by
    // "UNHANDLED: disposed during postMessage".
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const manager = new WebviewManager(
        {} as vscode.ExtensionContext,
        makeLogger(),
      );
      registerSurface(manager, 'sidebar', () => {
        throw new Error('disposed during postMessage');
      });
      const namespace = buildDashboardNamespace({
        broadcast: createDashboardBroadcast(() => manager, {
          debug: jest.fn(),
        }),
        logger: { info: jest.fn(), warn: jest.fn() },
      });

      const outcome = await namespace.proposeSpec(
        makeDashboardSpec(),
        CALLER,
      );

      expect(outcome.status).toBe('delivery-failed');
      expect(outcome.status === 'delivery-failed' && outcome.delivery).toEqual({
        status: 'failed',
        delivered: 0,
        surfaces: 1,
        reason: '1 of 1 attached surface(s) did not accept the spec',
      });

      // Give any escaped rejection a turn to surface before asserting.
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('reports failure for a surface whose postMessage rejects', async () => {
    const manager = new WebviewManager(
      {} as vscode.ExtensionContext,
      makeLogger(),
    );
    registerSurface(manager, 'sidebar', () =>
      Promise.reject(new Error('channel closed')),
    );
    const broadcast = createDashboardBroadcast(() => manager, {
      debug: jest.fn(),
    });

    const outcome = await broadcast(
      MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED,
      payload,
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.delivered).toBe(0);
  });
});

describe('buildDashboardNamespace › the byte budget is measured here', () => {
  it(`accepts a spec of exactly ${DASHBOARD_LIMITS.maxSpecBytes} UTF-8 bytes`, async () => {
    const { namespace, broadcast } = makeHarness();

    const outcome = await namespace.proposeSpec(
      makeDashboardSpecOfExactBytes(DASHBOARD_LIMITS.maxSpecBytes),
      CALLER,
    );

    expect(outcome.status).toBe('accepted');
    expect(outcome.status === 'accepted' && outcome.bytes).toBe(
      DASHBOARD_LIMITS.maxSpecBytes,
    );
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('rejects a spec one byte over, and dispatches nothing', async () => {
    const { namespace, broadcast } = makeHarness();

    const outcome = await namespace.proposeSpec(
      makeDashboardSpecOfExactBytes(DASHBOARD_LIMITS.maxSpecBytes + 1),
      CALLER,
    );

    expect(outcome.status).toBe('rejected');
    expect(outcome.status === 'rejected' && outcome.reason).toContain(
      `over the ${DASHBOARD_LIMITS.maxSpecBytes} byte limit`,
    );
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('measures UTF-8 bytes, not JS string length', async () => {
    // `jsonUtf8Bytes` is the real check. A string-length stand-in would let a
    // spec of 4-byte characters through at roughly double the intended size,
    // so a spec that is under the limit by length but over it by bytes must
    // still be refused.
    const wide = '😀'.repeat(1_000);
    const items: string[] = [];
    while (
      JSON.stringify(makeDashboardSpec({ components: [makeList(items)] }))
        .length <= DASHBOARD_LIMITS.maxSpecBytes
    ) {
      items.push(wide);
    }
    items.pop();
    const spec = makeDashboardSpec({ components: [makeList(items)] });
    expect(JSON.stringify(spec).length).toBeLessThanOrEqual(
      DASHBOARD_LIMITS.maxSpecBytes,
    );

    const { namespace, broadcast } = makeHarness();
    const outcome = await namespace.proposeSpec(spec, CALLER);

    expect(outcome.status).toBe('rejected');
    expect(outcome.status === 'rejected' && outcome.reason).toContain(
      `over the ${DASHBOARD_LIMITS.maxSpecBytes} byte limit`,
    );
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('createDashboardBroadcast > hardened v1 and v2 delivery', () => {
  const payload: DashboardSpecProposedPayload = {
    spec: makeDashboardSpec(),
    toolCallId: 'call-hardened',
  };
  const surfacePayload = {
    routingId: 'session-7',
    surfaceId: 'surface-1',
    revision: 2,
    origin: 'agent',
    change: { kind: 'ops', fromRevision: 1, ops: [] },
    toolCallId: 'call-surface',
    operationId: 'mcp:call-surface',
  } as const;
  const logger = { debug: jest.fn() };

  it.each(['throws', 'rejects'] as const)(
    'reports failed without an unhandled rejection when sendMessage %s',
    async (failure) => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', onUnhandled);
      try {
        const host: DashboardSurfaceHost = {
          getActiveWebviews: () => ['sidebar'],
          sendMessage: () => {
            if (failure === 'throws') throw new Error('disposed');
            return Promise.reject(new Error('channel closed'));
          },
        };
        const broadcast = createDashboardBroadcast(() => host, logger);

        await expect(
          broadcast(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, payload),
        ).resolves.toEqual({
          status: 'failed',
          delivered: 0,
          surfaces: 1,
          reason: '1 of 1 attached surface(s) did not accept the spec',
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    },
  );

  it('attempts every surface and reports partial delivery after throws and rejections', async () => {
    const attempted: string[] = [];
    const host: DashboardSurfaceHost = {
      getActiveWebviews: () => ['throws', 'rejects', 'delivered', 'refused'],
      sendMessage: (viewType) => {
        attempted.push(viewType);
        if (viewType === 'throws') throw new Error('disposed');
        if (viewType === 'rejects') return Promise.reject(new Error('closed'));
        return Promise.resolve(viewType === 'delivered');
      },
    };
    const broadcast = createDashboardBroadcast(() => host, logger);

    await expect(
      broadcast(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, payload),
    ).resolves.toEqual({
      status: 'failed',
      delivered: 1,
      surfaces: 4,
      reason: '3 of 4 attached surface(s) did not accept the spec',
    });
    expect(attempted).toEqual(['throws', 'rejects', 'delivered', 'refused']);
  });

  it.each([new Error('enumeration failed'), 'enumeration failed'])(
    'returns the error text when enumeration throws %p',
    async (error: unknown) => {
      const sendMessage = jest.fn(async () => true);
      const host: DashboardSurfaceHost = {
        getActiveWebviews: () => {
          throw error;
        },
        sendMessage,
      };
      const broadcast = createDashboardBroadcast(() => host, logger);

      await expect(
        broadcast(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, payload),
      ).resolves.toEqual({
        status: 'failed',
        delivered: 0,
        surfaces: 0,
        reason: 'enumeration failed',
      });
      expect(sendMessage).not.toHaveBeenCalled();
    },
  );

  it('delivers two back-to-back revision pushes to each host surface in call order', async () => {
    const sendMessage = jest.fn(async () => true);
    const host: DashboardSurfaceHost = {
      getActiveWebviews: () => ['sidebar', 'panel'],
      sendMessage,
    };
    const broadcast = createDashboardBroadcast(() => host, logger);
    const nextPayload = {
      ...surfacePayload,
      revision: 3,
      change: { kind: 'ops', fromRevision: 2, ops: [] },
    } as const;

    const first = broadcast(MESSAGE_TYPES.SURFACE_UPDATED, surfacePayload);
    const second = broadcast(MESSAGE_TYPES.SURFACE_UPDATED, nextPayload);
    expect(sendMessage).not.toHaveBeenCalled();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'delivered', surfaces: 2 },
      { status: 'delivered', surfaces: 2 },
    ]);
    expect(sendMessage.mock.calls).toEqual([
      ['sidebar', MESSAGE_TYPES.SURFACE_UPDATED, surfacePayload],
      ['panel', MESSAGE_TYPES.SURFACE_UPDATED, surfacePayload],
      ['sidebar', MESSAGE_TYPES.SURFACE_UPDATED, nextPayload],
      ['panel', MESSAGE_TYPES.SURFACE_UPDATED, nextPayload],
    ]);
  });

  it('delivers SURFACE_UPDATED with the original payload', async () => {
    const sendMessage = jest.fn(async () => true);
    const host: DashboardSurfaceHost = {
      getActiveWebviews: () => ['ptah.main'],
      sendMessage,
    };
    const broadcast = createDashboardBroadcast(() => host, logger);

    await expect(
      broadcast(MESSAGE_TYPES.SURFACE_UPDATED, surfacePayload),
    ).resolves.toEqual({ status: 'delivered', surfaces: 1 });
    expect(sendMessage).toHaveBeenCalledWith(
      'ptah.main', MESSAGE_TYPES.SURFACE_UPDATED, surfacePayload,
    );
  });
});

describe('createDashboardBroadcast with a throwing logger', () => {
  it('keeps no-host classified as no-surface after debug throws', async () => {
    const debug = jest.fn(() => { throw new Error('log channel closed'); });
    const broadcast = createDashboardBroadcast(() => undefined, { debug });
    await expect(broadcast(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED, {
      spec: makeDashboardSpec(), sessionId: 'tab-a', toolCallId: 'call-1',
    })).resolves.toEqual({ status: 'no-surface' });
    expect(debug).toHaveBeenCalledTimes(1);
  });
});
