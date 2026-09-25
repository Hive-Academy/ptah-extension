/**
 * Trust-boundary tests for surface contract v2 at the vscode-lm-tools
 * MCP/host boundary (TASK_2026_538_3ccf, batch 15, NFR "Security").
 *
 * The NFR row names `dashboard-trust-boundary.spec.ts` for these v2 cases;
 * `implementation-plan.md` and `batches.md` (Task 15.2) route the two cases
 * that need a real host and a real routing id to a companion file in this
 * project instead, because that is where `DashboardSurfaceHost` and
 * `SurfaceStateService` live. This file records that file-name deviation
 * here, as the NFR text anticipates.
 *
 * Two controls are proven, because nothing else in this task folder proves
 * them at THIS boundary:
 *
 *  - Markup characters travel unparsed and unescaped all the way to the push
 *    payload the host receives (`DashboardSurfaceHost.sendMessage`), not just
 *    through the shared validator (proven in `dashboard-trust-boundary.spec.ts`,
 *    v2 additions, at the shared-package boundary).
 *  - A cross-routing-id read returns not-found for each tool, at the same
 *    `SurfaceNamespace` seam the MCP dispatcher calls
 *    (`surface-tool-handlers.ts`).
 *
 * The exhaustive cross-routing-id matrix (foreign sessionId, missing id, and
 * a forged sessionId/routingId argument, for BOTH `ptah_surface_update` and
 * `ptah_surface_get_state`) is already pinned in
 * `surface-namespace.builder.spec.ts` ("returns the same not-found result for
 * foreign and missing ids for each tool", "rejects a forged %s in tool
 * arguments"). This file does not repeat that matrix; it adds one confirming
 * case per tool, named as a trust-boundary control.
 *
 * Carried from Batch 11 (per batches.md Task 15.2): no raw error text crosses
 * the RPC boundary, and the submit deadline/indeterminate details are fixed
 * strings (`SURFACE_SUBMIT_INDETERMINATE_DETAIL`, `SURFACE_SUBMIT_DEADLINE_DETAIL`).
 * That is already pinned in `surface-submit-turn.service.spec.ts` and
 * `surface-submit-turn.deadline.spec.ts`; it is not duplicated here.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SurfaceEnvelope } from '@ptah-extension/shared';
import type { DashboardSurfaceHost } from '../code-execution/namespace-builders/dashboard-namespace.builder';
import { buildSurfaceNamespace } from '../code-execution/namespace-builders/surface-namespace.builder';
import { SurfaceStateService } from './surface-state.service';

const CALLER_A = { sessionId: 'tab-a', toolCallId: 'call-a' };
const CALLER_B = { sessionId: 'tab-b', toolCallId: 'call-b' };

/** Angle brackets and an inline event handler: the classic innerHTML probe. */
const MARKUP = '<img src=x onerror=alert(1)><script>alert(document.cookie)</script>';

function markupSurface(surfaceId = 'profile'): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2',
    surfaceId,
    title: { text: MARKUP },
    components: [
      { kind: 'stat', id: 'tile', title: { text: MARKUP }, value: MARKUP },
    ],
  };
}

interface PushedSnapshotPayload {
  readonly change: {
    readonly kind: string;
    readonly state?: {
      readonly content?: {
        readonly surface?: {
          readonly title?: { readonly text?: string };
          readonly components?: readonly {
            readonly title?: { readonly text?: string };
            readonly value?: unknown;
          }[];
        };
      };
    };
  };
}

function setup() {
  const write = jest.fn();
  const logger = { info: write, warn: write, debug: write };
  const sendMessage = jest.fn(async () => true);
  const host: DashboardSurfaceHost = {
    getActiveWebviews: () => ['ptah.main'],
    sendMessage,
  };
  const service = new SurfaceStateService(logger as unknown as Logger, {
    getHost: () => host,
  });
  const namespace = buildSurfaceNamespace({ service, logger });
  return { namespace, sendMessage };
}

describe('surface v2 trust boundary — vscode-lm-tools push and routing', () => {
  it('carries markup characters unparsed and unescaped through to the push payload the host receives', async () => {
    const { namespace, sendMessage } = setup();

    const outcome = await namespace.update(
      { operation: 'create', surface: markupSurface() },
      CALLER_A,
    );

    expect(outcome.status).toBe('accepted');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [viewId, messageType, payload] = sendMessage.mock.calls[0] as unknown as [
      string,
      string,
      PushedSnapshotPayload,
    ];
    expect(viewId).toBe('ptah.main');
    expect(messageType).toBe('surface:updated');
    expect(payload.change.kind).toBe('snapshot');
    const surface = payload.change.state?.content?.surface;
    expect(surface?.title?.text).toBe(MARKUP);
    expect(surface?.components?.[0]?.title?.text).toBe(MARKUP);
    expect(surface?.components?.[0]?.value).toBe(MARKUP);
    // Proves the string is carried as inert data, not interpreted anywhere
    // in the push path: the raw angle brackets and the script tag are still
    // there, never HTML-entity-escaped or stripped.
    expect(JSON.stringify(payload)).toContain('<script>alert(document.cookie)</script>');
  });

  it('returns not-found for a cross-routing-id read on ptah_surface_get_state', async () => {
    const { namespace } = setup();
    await namespace.update(
      { operation: 'create', surface: markupSurface() },
      CALLER_A,
    );

    await expect(
      namespace.getState({ surfaceId: 'profile' }, CALLER_B),
    ).resolves.toMatchObject({ status: 'not-found' });
    // The unscoped index view is not-found too: tab-b's store is empty, and
    // tab-a's surface never appears in it.
    await expect(namespace.getState({}, CALLER_B)).resolves.toMatchObject({
      status: 'not-found',
      text: expect.not.stringContaining('profile'),
    });
  });

  it('returns not-found (as a rejection naming it) for a cross-routing-id write on ptah_surface_update', async () => {
    const { namespace, sendMessage } = setup();
    await namespace.update(
      { operation: 'create', surface: markupSurface() },
      CALLER_A,
    );
    sendMessage.mockClear();

    await expect(
      namespace.update(
        {
          operation: 'patch',
          surfaceId: 'profile',
          baseRevision: 1,
          ops: [{ op: 'set-data', path: 'form.name', value: 'Grace' }],
        },
        CALLER_B,
      ),
    ).resolves.toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('not-found'),
    });
    // Nothing was pushed for a routing id that never owned this surface.
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
